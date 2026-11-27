"""Read Gizmo's reservation calendar and process native booking jobs on the club network."""

import re
from datetime import datetime, timedelta, timezone

from .services import ApiError


def utcnow():
    return datetime.now(timezone.utc)


def timestamp(value):
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def overlaps(start, end, other_start, other_end):
    return start < other_end and other_start < end


def linked_users(row):
    return {row.get("userId"), *(user["userId"] for user in row.get("users") or [])}


class NativeBookings:
    def __init__(self, gizmo, cloud, bridge, active_status, unit_seconds):
        if active_status not in (0, 1) or unit_seconds not in (1, 60):
            raise ValueError("Проверьте GIZMO_RESERVATION_ACTIVE_STATUS и GIZMO_RESERVATION_UNIT_SECONDS")
        self.gizmo = gizmo
        self.cloud = cloud
        self.bridge = bridge
        self.active_status = active_status
        self.unit_seconds = unit_seconds
        self.error = ""
        self.outcome = None
        self.calendar = []
        self.calendar_at = None

    def server(self, operation, **data):
        return self.cloud.desk("native_bookings", operation=operation, data=data)

    def active_reservations(self):
        rows = {}
        for _ in range(30):
            page = self.gizmo.request("GET", "reservations", params={
                "Status": self.active_status, "Skip": len(rows), "Take": 100,
            })
            if not isinstance(page, list) or len(page) > 100:
                raise ApiError("Gizmo: неверный список броней")
            for row in page:
                if row.get("status") != self.active_status or not row.get("id") or row["id"] in rows:
                    raise ApiError("Gizmo: список броней изменился или фильтр не поддерживается")
                rows[row["id"]] = row
            # Keep paging until empty, including installations with a lower server page size.
            if not page:
                return list(rows.values())
        raise ApiError("Gizmo: слишком много активных броней для полной сверки")

    def observe(self):
        observed_at = utcnow()
        hosts = {}
        by_number = {}
        available_ids = {}
        for host in self.gizmo.hosts():
            number = str(host["number"])
            if int(host["id"]) in hosts:
                raise ApiError("Gizmo: повторяющийся внутренний ID ПК")
            hosts[int(host["id"])] = number
            if host.get("isDeleted") or not re.fullmatch(r"[0-9]{2,4}", number):
                continue
            if number in by_number:
                raise ApiError("Gizmo: несколько ПК с одинаковым номером")
            available_ids[number] = int(host["id"])
            by_number[number] = {
                "host_id": number,
                "status": "free" if host.get("state") == 0 else "unavailable",
            }
        for session in self.gizmo.sessions():
            host = by_number.get(str(session.get("hostNumber")))
            if host and host["status"] == "free":
                host["status"] = "busy"
                host["free_at"] = self.bridge.free_at(session["userId"]) if session.get("userId") else None

        intervals = []
        reservations = self.active_reservations()
        for row in reservations:
            start, end = timestamp(row["date"]), timestamp(row["endDate"])
            if end <= observed_at:
                continue
            if end <= start or not row.get("hosts"):
                raise ApiError("Gizmo: некорректный интервал или ПК в расписании")
            for seat in row["hosts"]:
                number = hosts.get(int(seat["hostId"]))
                if number in by_number:
                    intervals.append({
                        "gizmo_id": row["id"], "host_id": number,
                        "starts_at": start.isoformat(), "ends_at": end.isoformat(),
                    })
                elif number is None:
                    raise ApiError("Gizmo: бронь с неизвестным внутренним ID ПК")
        snapshot = {
            "observed_at": observed_at.isoformat(), "hosts": list(by_number.values()),
            "reservations": intervals,
        }
        if utcnow() - observed_at > timedelta(seconds=20):
            raise ApiError("Gizmo: расписание обновлялось слишком долго")
        return snapshot, available_ids, reservations

    def verify(self, row, job, host_id):
        start, end = timestamp(job["starts_at"]), timestamp(job["ends_at"])
        return (row.get("status") == self.active_status
                and row.get("note") == "1SHOT app request=" + job["id"]
                and row.get("userId") == job["gizmo_user_id"]
                and row.get("hosts") is not None
                and [int(seat["hostId"]) for seat in row["hosts"]] == [host_id]
                and timestamp(row["date"]) == start and timestamp(row["endDate"]) == end)

    def create(self, job):
        started, end = timestamp(job["starts_at"]), timestamp(job["ends_at"])
        user = job["gizmo_user_id"]
        self.gizmo.user(user)
        snapshot, hosts, reservations = self.observe()
        host = next((h for h in snapshot["hosts"] if h["host_id"] == job["host_id"]), None)
        now = utcnow()
        if (started <= now or not host or host["status"] == "unavailable"
                or (host["status"] == "busy" and (not host.get("free_at") or
                    not now < timestamp(host["free_at"]) <= started))):
            return {"status": "failed", "message": "ПК недоступен на выбранное время"}
        number = host["host_id"]
        host_id = hosts[number]
        if any(r["host_id"] == number and overlaps(started, end, timestamp(r["starts_at"]), timestamp(r["ends_at"]))
               for r in snapshot["reservations"]) or any(
                   user in linked_users(r) and overlaps(started, end, timestamp(r["date"]), timestamp(r["endDate"]))
                   for r in reservations):
            return {"status": "failed", "message": "Интервал уже занят. Выберите другой ПК или время"}

        self.server("permit", id=job["id"])  # Check the lease after the reads, immediately before writing.
        reservation_id = None
        try:
            result = self.gizmo.request("PUT", "reservations", params={
                "Date": started.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "Duration": int((end - started).total_seconds()) // self.unit_seconds,
                "UserId": user, "Hosts[0].HostId": host_id,
                "Note": "1SHOT app request=" + job["id"],
            })
            if isinstance(result, dict):
                result = result.get("id")
            if type(result) is not int or result <= 0:
                raise ApiError("Gizmo: не вернул ID брони")
            reservation_id = result
            path = f"reservations/{reservation_id}"
            self.server("permit", id=job["id"], linking=True)
            self.gizmo.request("PUT", f"{path}/users/{user}")
            row = self.gizmo.request("GET", path)
            if (row.get("id") != reservation_id or not self.verify(row, job, host_id)
                    or {u["userId"] for u in row.get("users") or []} != {user}):
                raise ApiError("Gizmo: созданная бронь не совпадает с заявкой")
            _, _, current = self.observe()
            if any(r["id"] != reservation_id and (
                    host_id in [int(h["hostId"]) for h in r.get("hosts") or []] or user in linked_users(r))
                   and overlaps(started, end, timestamp(r["date"]), timestamp(r["endDate"])) for r in current):
                raise ApiError("Gizmo: при сверке найдена пересекающаяся бронь")
            return {"status": "confirmed", "gizmo_id": reservation_id}
        except Exception as error:
            self.error = str(error)[:160]
            return {"status": "review", "gizmo_id": reservation_id,
                    "message": "Проверьте бронь у администратора клуба"}

    def cancel(self, job):
        path = f"reservations/{job['gizmo_id']}"
        # A moved/edited/shared booking belongs in Gizmo Manager for manual review.
        row = self.gizmo.request("GET", path)
        hosts = [h["id"] for h in self.gizmo.hosts()
                 if str(h["number"]) == job["host_id"] and not h.get("isDeleted")]
        if (row.get("id") != job["gizmo_id"] or len(hosts) != 1 or not self.verify(row, job, hosts[0])
                or linked_users(row) != {job["gizmo_user_id"]}):
            return {"status": "review", "message": "Бронь изменилась. Обратитесь к администратору"}
        if timestamp(job["starts_at"]) <= utcnow():
            return {"status": "confirmed", "message": "Время уже наступило. Обратитесь к администратору"}

        self.server("permit", id=job["id"])
        cancelled = 1 - self.active_status  # Both values must be checked on this installation before enabling.
        self.gizmo.request("POST", f"{path}/status/{cancelled}")
        actual = self.gizmo.request("GET", path)
        if actual.get("id") != job["gizmo_id"] or actual.get("status") != cancelled:
            raise ApiError("Gizmo: отмена не подтверждена")
        return {"status": "cancelled"}

    def tick(self):
        if self.outcome:
            if not self.server("finish", **self.outcome).get("ok"):
                self.error = "Заявка Gizmo требует ручной сверки"
            self.outcome = None
        if not self.server("mode")["enabled"]:
            self.error = ""
            self.calendar = []
            self.calendar_at = None
            return
        schedule, _, reservations = self.observe()
        sources = {row["id"]: row for row in reservations}
        self.calendar = [
            {**item, "account_id": sources[item["gizmo_id"]].get("userId"),
             "from_app": str(sources[item["gizmo_id"]].get("note") or "").startswith("1SHOT app request=")}
            for item in schedule["reservations"]
        ]
        self.calendar_at = schedule["observed_at"]
        state = self.server("sync", **schedule)
        self.error = "Брони на ручной сверке: " + str(state["review_count"]) if state["review_count"] else ""
        for change in state["changed"][:3]:
            try:
                row = self.gizmo.request("GET", f"reservations/{change['gizmo_id']}")
            except ApiError:
                continue  # Absence or a failed read is not proof of cancellation.
            if (row.get("id") == change["gizmo_id"] and row.get("status") == 1 - self.active_status
                    and row.get("note") == "1SHOT app request=" + change["id"]):
                self.server("manual_cancelled", **change)
        job = self.server("claim").get("job")
        if not job:
            return
        try:
            result = self.create(job) if job["status"] == "creating" else self.cancel(job)
        except Exception as error:
            self.error = str(error)[:160]
            if job["status"] == "creating":
                result = {"status": "failed", "message": "Не удалось проверить ПК или аккаунт"}
            else:
                result = {"status": "review", "message": "Отмену нужно проверить у администратора"}
        self.outcome = {"id": job["id"], **result}
        if not self.server("finish", **self.outcome).get("ok"):
            self.error = "Заявка Gizmo требует ручной сверки"
        self.outcome = None

    def loop(self, stop, online):
        while not stop.wait(5):
            if not online():
                continue
            try:
                self.tick()
            except Exception as error:
                self.error = str(error)[:160]
