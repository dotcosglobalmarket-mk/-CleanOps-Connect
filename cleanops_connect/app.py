from __future__ import annotations

from dataclasses import dataclass

from .controllers import CleanerController, JobController, PlatformController, SubscriptionController
from .middleware import AuthMiddleware, RequestContextMiddleware
from .models import ServiceType
from .repositories import RepositoryBundle
from .services import (
    AILeadScoringService,
    CleanerOnboardingService,
    InsuranceAddOnService,
    JobCreationService,
    MapboxPostcodeGeocodingService,
    SpatialFilteringService,
    SubscriptionBillingService,
)


@dataclass(slots=True)
class Application:
    repositories: RepositoryBundle
    controllers: dict[str, object]
    services: dict[str, object]
    middleware: dict[str, object]


def create_application(mapbox_token: str | None = None) -> Application:
    repositories = RepositoryBundle()
    repositories.service_types.add(
        "domestic-standard",
        ServiceType(code="domestic-standard", name="Domestic Standard Clean", category="domestic"),
    )
    repositories.service_types.add(
        "industrial-deep-clean",
        ServiceType(
            code="industrial-deep-clean",
            name="Industrial Deep Clean",
            category="industrial",
            insurance_required=True,
        ),
    )

    geocoding_service = MapboxPostcodeGeocodingService(access_token=mapbox_token)
    scoring_service = AILeadScoringService()
    insurance_service = InsuranceAddOnService()
    spatial_filtering_service = SpatialFilteringService()
    onboarding_service = CleanerOnboardingService(repositories, insurance_service)
    job_creation_service = JobCreationService(repositories, geocoding_service, scoring_service)
    billing_service = SubscriptionBillingService()

    services = {
        "mapbox_geocoding": geocoding_service,
        "ai_lead_scoring": scoring_service,
        "spatial_filtering": spatial_filtering_service,
        "cleaner_onboarding": onboarding_service,
        "job_creation": job_creation_service,
        "subscription_billing": billing_service,
        "insurance_add_on": insurance_service,
    }
    controllers = {
        "platform": PlatformController(),
        "cleaners": CleanerController(onboarding_service),
        "jobs": JobController(job_creation_service, spatial_filtering_service),
        "subscriptions": SubscriptionController(billing_service),
    }
    middleware = {
        "request_context": RequestContextMiddleware(),
        "auth": AuthMiddleware(),
    }
    return Application(repositories=repositories, controllers=controllers, services=services, middleware=middleware)
