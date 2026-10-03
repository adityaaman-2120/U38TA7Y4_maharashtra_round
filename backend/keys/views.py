from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EncryptedKeyBlob
from .serializers import KeyBlobSerializer


class KeyBlobView(APIView):
    throttle_scope = "default"

    def get(self, request):
        try:
            record = request.user.key_blob
        except EncryptedKeyBlob.DoesNotExist:
            return Response({"detail": "No key stored."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"blob": record.blob})

    def put(self, request):
        s = KeyBlobSerializer(data=request.data, context={"address": request.user.address})
        s.is_valid(raise_exception=True)
        blob, public_key = s.validated_data["blob"], s.public_key

        existing = EncryptedKeyBlob.objects.filter(user=request.user).first()
        if existing is None:
            EncryptedKeyBlob.objects.create(user=request.user, blob=blob, public_key=public_key)
            return Response({"blob": blob}, status=status.HTTP_201_CREATED)
        # Re-sealing the same key (e.g. a password change) is fine. Swapping in a different key would orphan every
        # share already encrypted to the old one, so it is refused.
        if existing.public_key != public_key:
            return Response(
                {"detail": "A different encryption key is already stored for this account."},
                status=status.HTTP_409_CONFLICT,
            )
        existing.blob = blob
        existing.save(update_fields=["blob", "updated_at"])
        return Response({"blob": blob})
