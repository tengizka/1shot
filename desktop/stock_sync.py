"""Publish the Desk inventory snapshot through the existing worker report API."""

import logging
from datetime import datetime, timezone

from .services import ApiError

REPORT_KIND = 'product_stock'
REFRESH_SECONDS = 300
RETRY_SECONDS = 30
logger = logging.getLogger(__name__)


def sync_loop(stop, food, cloud, online):
    """Refresh after the worker connects, and retry without blocking Desk."""
    while not stop.is_set():
        delay = RETRY_SECONDS
        if online():
            try:
                items = food.stock_overview()
                if stop.is_set():
                    return
                result = cloud.desk(
                    'report',
                    kind=REPORT_KIND,
                    data={'at': datetime.now(timezone.utc).isoformat(), 'items': items},
                )
                if result.get('ok') is not True:
                    raise ApiError('Supabase не подтвердил приём остатков')
                delay = REFRESH_SECONDS
            except Exception:
                logger.warning('Не удалось синхронизировать остатки. Desk повторит попытку.', exc_info=True)
        if stop.wait(delay):
            return
