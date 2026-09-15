from __future__ import annotations

from dataclasses import asdict, dataclass

from .models import CleanerProfile, Job, Subscription
from .services import (
    CleanerOnboardingService,
    JobCreationService,
    SpatialFilteringService,
    SubscriptionBillingService,
)


@dataclass(slots=True)
class PlatformController:
    def health(self) -> dict[str, str]:
        return {"status": "ok", "service": "cleanops-connect-backend-scaffold"}


@dataclass(slots=True)
class CleanerController:
    onboarding_service: CleanerOnboardingService

    def onboard(self, payload: dict[str, object]) -> dict[str, object]:
        return self.onboarding_service.onboard_cleaner(**payload)


@dataclass(slots=True)
class JobController:
    job_creation_service: JobCreationService
    spatial_filtering_service: SpatialFilteringService

    def create(self, payload: dict[str, object]) -> dict[str, object]:
        return self.job_creation_service.create_job(**payload)

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
