from django.db import models


class IndexerState(models.Model):
    """Progress of the indexer for one deployed contract."""

    chain_id = models.PositiveIntegerField()
    address = models.CharField(max_length=42)  # lower-case contract address
    last_block = models.BigIntegerField()  # highest block fully indexed (start_block - 1 before the first run)
    last_block_hash = models.CharField(max_length=66, blank=True)  # hash of last_block when it was indexed, to detect reorgs
    head_block = models.BigIntegerField(default=0)  # chain head seen on the last run
    head_time = models.BigIntegerField(default=0)  # timestamp of that head block: the chain's idea of "now"
    updated_at = models.DateTimeField(auto_now=True)
    last_error = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["chain_id", "address"], name="one_state_per_deployment")]


class ChainEvent(models.Model):
    """One decoded contract log. (chain, tx, log index) is the identity, which makes re-indexing idempotent."""

    chain_id = models.PositiveIntegerField()
    address = models.CharField(max_length=42)  # lower-case contract address
    block_number = models.BigIntegerField()
    block_hash = models.CharField(max_length=66)
    timestamp = models.BigIntegerField()  # block time, unix seconds
    tx_hash = models.CharField(max_length=66)
    log_index = models.PositiveIntegerField()
    event_name = models.CharField(max_length=40)
    args = models.JSONField()
    tx_from = models.CharField(max_length=42, blank=True)  # who sent the transaction
    # Denormalised from args so the common questions are plain indexed lookups.
    asset_id = models.BigIntegerField(null=True, blank=True)
    claim_id = models.BigIntegerField(null=True, blank=True)
    owner = models.CharField(max_length=42, blank=True)  # vault owner the event concerns
    participants = models.TextField(blank=True)  # ",0xabc,0xdef," every address in args plus the sender
    processed = models.BooleanField(default=False)  # notifications have been created for it

    class Meta:
        constraints = [models.UniqueConstraint(fields=["chain_id", "tx_hash", "log_index"], name="unique_log")]
        indexes = [
            models.Index(fields=["chain_id", "address", "block_number", "log_index"]),
            models.Index(fields=["chain_id", "address", "asset_id"]),
            models.Index(fields=["chain_id", "address", "claim_id"]),
            models.Index(fields=["chain_id", "address", "owner", "event_name"]),
            models.Index(fields=["processed"]),
        ]
        ordering = ["block_number", "log_index"]

    def __str__(self) -> str:
        return f"{self.event_name}@{self.block_number}"
