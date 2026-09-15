from __future__ import annotations

from dataclasses import asdict, dataclass

from .models import CleanerProfile, Job, Subscription
from .services import (
    CleanerOnboardingService,
    JobCreationService,
    SpatialFilteringService,
    SubscriptionBillingService,
)


def _validated_payload(
    payload: dict[str, object],
    *,
    required_fields: set[str],
    optional_fields: set[str] | None = None,
) -> dict[str, object]:
    optional_fields = optional_fields or set()
    allowed_fields = required_fields | optional_fields
    unexpected_fields = sorted(set(payload) - allowed_fields)
    missing_fields = sorted(required_fields - set(payload))
    if unexpected_fields or missing_fields:
        details: list[str] = []
        if missing_fields:
            details.append(f"missing fields: {', '.join(missing_fields)}")
        if unexpected_fields:
            details.append(f"unexpected fields: {', '.join(unexpected_fields)}")
        raise ValueError("; ".join(details))
    return {key: payload[key] for key in allowed_fields if key in payload}


@dataclass(slots=True)
class PlatformController:
    def health(self) -> dict[str, str]:
        return {"status": "ok", "service": "cleanops-connect-backend-scaffold"}


@dataclass(slots=True)
class CleanerController:
    onboarding_service: CleanerOnboardingService

    def onboard(self, payload: dict[str, object]) -> dict[str, object]:
        validated_payload = _validated_payload(
            payload,
            required_fields={"email", "postcode", "business_name", "service_type_codes", "insurance_opt_in"},
            optional_fields={"compliance_checks"},
        )
        return self.onboarding_service.onboard_cleaner(**validated_payload)


@dataclass(slots=True)
class JobController:
    job_creation_service: JobCreationService
    spatial_filtering_service: SpatialFilteringService

    def create(self, payload: dict[str, object]) -> dict[str, object]:
        validated_payload = _validated_payload(
            payload,
            required_fields={"customer_name", "postcode", "service_type_code"},
            optional_fields={"metadata"},
        )
        return self.job_creation_service.create_job(**validated_payload)

    def match_cleaners(self, job: Job, cleaners: list[CleanerProfile]) -> dict[str, object]:
        matched_cleaners = self.spatial_filtering_service.filter_cleaners(job, cleaners)
        return {
            "job": asdict(job),
            "matched_cleaners": [asdict(cleaner) for cleaner in matched_cleaners],
        }


@dataclass(slots=True)
class SubscriptionController:
    billing_service: SubscriptionBillingService

    def preview_billing(self, subscription: Subscription) -> dict[str, object]:
        return self.billing_service.preview_invoice(subscription)
