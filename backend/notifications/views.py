from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "body", "urgent", "view", "chain_id", "asset_id", "claim_id", "created_at", "read"]

    def get_read(self, n) -> bool:
        return n.read_at is not None


class NotificationListView(APIView):
    throttle_scope = "default"

    def get(self, request):
        mine = Notification.objects.filter(user=request.user)
        unread = mine.filter(read_at__isnull=True)
        rows = (unread if request.query_params.get("unread") == "1" else mine)[:50]
        return Response({"results": NotificationSerializer(rows, many=True).data, "unread_count": unread.count()})


class MarkReadView(APIView):
    """Body: {"ids": [1, 2]} or {"all": true}. Only ever touches the caller's own notifications."""

    throttle_scope = "default"

    def post(self, request):
        qs = Notification.objects.filter(user=request.user, read_at__isnull=True)
        if request.data.get("all") is True:
            pass
        else:
            ids = request.data.get("ids")
            if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids) or len(ids) > 200:
                return Response({"detail": "Send {\"ids\": [...]} or {\"all\": true}."}, status=400)
            qs = qs.filter(pk__in=ids)
        updated = qs.update(read_at=timezone.now())
        return Response({"updated": updated, "unread_count": Notification.objects.filter(user=request.user, read_at__isnull=True).count()})
