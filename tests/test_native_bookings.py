import unittest
from datetime import timedelta
from unittest.mock import Mock

from desktop.native_bookings import NativeBookings, utcnow
from desktop.services import ApiError


class NativeBookingTests(unittest.TestCase):
    def setUp(self):
        start = utcnow().replace(second=0, microsecond=0) + timedelta(hours=1)
        end = start + timedelta(hours=2)
        self.job = {
            "id": "abc", "host_id": "105", "gizmo_user_id": 88, "gizmo_id": 52,
            "starts_at": start.isoformat(), "ends_at": end.isoformat(),
        }
        self.row = {
            "id": 52, "note": "1SHOT app request=abc", "userId": 88, "hosts": [{"hostId": 37}],
            "users": [{"userId": 88}], "status": 0, "date": start.isoformat(), "endDate": end.isoformat(),
        }
        self.gizmo = Mock()
        self.gizmo.hosts.return_value = [{"id": 37, "number": 105, "state": 0}]
        self.gizmo.sessions.return_value = []
        self.cloud = Mock()
        self.worker = NativeBookings(self.gizmo, self.cloud, Mock(), 0, 60)
        self.records = []
        self.gizmo.request.side_effect = self.respond

    def respond(self, method, path, **kwargs):
        if method == "GET" and path == "reservations":
            return self.records[kwargs["params"]["Skip"]:]
        if method == "PUT" and path == "reservations":
            self.records.append(self.row)
            return self.row["id"]
        if method == "PUT" and path == "reservations/52/users/88":
            return None
        if method == "POST" and path == "reservations/52/status/1":
            self.row["status"] = 1
            self.records.remove(self.row)
            return None
        if method == "GET" and path == "reservations/52":
            return self.row
        raise AssertionError((method, path))

    def test_create_verifies_host_link_duration_and_cancel(self):
        self.assertEqual(self.worker.create(self.job), {"status": "confirmed", "gizmo_id": 52})
        put = next(call for call in self.gizmo.request.call_args_list if call.args == ("PUT", "reservations"))
        self.assertEqual(put.kwargs["params"]["Duration"], 120)
        self.assertEqual(put.kwargs["params"]["Hosts[0].HostId"], 37)
        self.assertEqual(self.worker.cancel(self.job), {"status": "cancelled"})

    def test_new_manual_booking_blocks_before_put_and_hides_personal_data(self):
        self.records.append(dict(self.row, id=70, userId=77, note="confidential", contactPhone="secret"))
        calendar, _, _ = self.worker.observe()
        self.assertEqual(set(calendar["reservations"][0]), {"gizmo_id", "host_id", "starts_at", "ends_at"})
        self.assertEqual(self.worker.create(self.job)["status"], "failed")
        self.assertTrue(all(call.args[0] == "GET" for call in self.gizmo.request.call_args_list))

    def test_overlap_written_during_put_goes_to_review(self):
        def insert_conflict(method, path, **kwargs):
            result = self.respond(method, path, **kwargs)
            if method == "PUT" and path == "reservations":
                self.records.append(dict(self.row, id=71, userId=77, note="manual"))
            return result

        self.gizmo.request.side_effect = insert_conflict
        result = self.worker.create(self.job)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["gizmo_id"], 52)

    def test_unknown_outcome_and_edited_booking_never_replay_mutations(self):
        def lost_response(method, path, **kwargs):
            result = self.respond(method, path, **kwargs)
            if method == "PUT" and path == "reservations":
                raise ApiError("timeout")
            return result

        self.gizmo.request.side_effect = lost_response
        self.assertEqual(self.worker.create(self.job)["status"], "review")
        self.row["note"] = "moved by manager"
        self.assertEqual(self.worker.cancel(self.job)["status"], "review")
        mutations = [call.args for call in self.gizmo.request.call_args_list if call.args[0] != "GET"]
        self.assertEqual(mutations, [("PUT", "reservations")])

    def test_truncated_calendar_cannot_be_treated_as_empty(self):
        self.gizmo.request.return_value = [self.row]
        self.gizmo.request.side_effect = None
        with self.assertRaisesRegex(ApiError, "список броней"):
            self.worker.observe()
