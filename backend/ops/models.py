from django.db import models


class TickLock(models.Model):
    """A lease on the scheduler tick. One row; a tick takes it with a single compare-and-set UPDATE, so two overlapping
    calls (cron retry, a slow previous run) can never both run, on any database and behind a connection pooler."""

    locked_until = models.DateTimeField(null=True, blank=True)
    last_started_at = models.DateTimeField(null=True, blank=True)
    last_finished_at = models.DateTimeField(null=True, blank=True)
    last_result = models.JSONField(default=dict, blank=True)
