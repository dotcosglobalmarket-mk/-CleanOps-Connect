from __future__ import annotations

from dataclasses import asdict
from itertools import count
from math import asin, cos, radians, sin, sqrt
from typing import Iterable

from .models import CleanerProfile, Job, JobOffer, ServiceType, Subscription, User
from .repositories import RepositoryBundle


def _normalise_postcode(postcode: str) -> str:
    return " ".join(postcode.upper().split())


class MapboxPostcodeGeocodingService:
    def __init__(self, access_token: str | None = None) -> None:
        self.access_token = access_token

    def geocode_postcode(self, postcode: str) -> dict[str, object]:
        normalised = _normalise_postcode(postcode)
        seed = sum(ord(char) for char in normalised if char.isalnum())
        latitude = round(49.9 + (seed % 850) / 100, 6)
        longitude = round(-7.6 + (seed % 760) / 100, 6)
        configured = bool(self.access_token)
        return {
            "postcode": normalised,
            "latitude": latitude,
            "longitude": longitude,
            "provider": "mapbox",
            "configured": configured,
            "mode": "live" if configured else "placeholder",
        }


class AILeadScoringService:
    def score_job(self, job: Job, service_type: ServiceType) -> dict[str, object]:
        score = 45
        if service_type.category == "industrial":
            score += 20
        if job.metadata.get("urgent"):
            score += 15
        if job.metadata.get("recurring"):
            score += 10
        score = max(0, min(score, 100))
        return {"job_id": job.id, "score": score, "model": "placeholder-rule-engine"}


class SpatialFilteringService:
    def filter_cleaners(self, job: Job, cleaners: Iterable[CleanerProfile]) -> list[CleanerProfile]:
        matches: list[CleanerProfile] = []
        for cleaner in cleaners:
            if job.service_type_code not in cleaner.service_type_codes:
                continue
            if None not in (job.latitude, job.longitude, cleaner.latitude, cleaner.longitude):
                distance = self._distance_miles(job.latitude, job.longitude, cleaner.latitude, cleaner.longitude)
                if distance <= cleaner.radius_miles:
                    matches.append(cleaner)
                    continue
            job_postcode = _normalise_postcode(job.postcode)
            if any(job_postcode == _normalise_postcode(postcode) for postcode in cleaner.coverage_postcodes):
                matches.append(cleaner)
        return matches

    @staticmethod
    def _distance_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius = 3958.8
        lat1_rad, lon1_rad, lat2_rad, lon2_rad = map(radians, (lat1, lon1, lat2, lon2))
        d_lat = lat2_rad - lat1_rad
        d_lon = lon2_rad - lon1_rad
        hav = sin(d_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(d_lon / 2) ** 2
        return 2 * radius * asin(sqrt(hav))


class InsuranceAddOnService:
    def determine_add_on(self, service_type: ServiceType, wants_cover: bool) -> dict[str, object]:
        eligible = service_type.insurance_required or wants_cover
        add_on_gbp = 19.99 if eligible else 0.0
        return {
            "service_type": service_type.code,
            "eligible": eligible,
            "required": service_type.insurance_required,
            "add_on_gbp": add_on_gbp,
        }


class CleanerOnboardingService:
    def __init__(self, repositories: RepositoryBundle, insurance_service: InsuranceAddOnService) -> None:
        self.repositories = repositories
        self.insurance_service = insurance_service
        self._user_ids = count(1)
        self._cleaner_ids = count(1)
        self._subscription_ids = count(1)

    def onboard_cleaner(
        self,
        *,
        email: str,
        postcode: str,
        business_name: str,
        service_type_codes: list[str],
        insurance_opt_in: bool,
        compliance_checks: dict[str, bool] | None = None,
    ) -> dict[str, object]:
        selected_service_types = []
        unknown_service_type_codes = []
        for code in service_type_codes:
            service_type = self.repositories.service_types.get(code)
            if service_type is None:
                unknown_service_type_codes.append(code)
                continue
            selected_service_types.append(service_type)
        if unknown_service_type_codes:
            unknown_codes = ", ".join(sorted(unknown_service_type_codes))
            raise ValueError(f"Unknown service type codes: {unknown_codes}")

        user = User(
            id=f"user-{next(self._user_ids)}",
            email=email,
            role="cleaner",
            postcode=_normalise_postcode(postcode),
        )
        cleaner = CleanerProfile(
            id=f"cleaner-{next(self._cleaner_ids)}",
            user_id=user.id,
            business_name=business_name,
            service_type_codes=service_type_codes,
            coverage_postcodes=[user.postcode],
            is_onboarded=True,
            insurance_opt_in=insurance_opt_in,
            compliance_checks=compliance_checks or {"dbs": False, "coshh": False},
        )
        insurance_required = any(service_type.insurance_required for service_type in selected_service_types)
        insurance_summary = self.insurance_service.determine_add_on(
            ServiceType(
                code="combined-cleaner-services",
                name="Combined Cleaner Services",
                category="mixed",
                insurance_required=insurance_required,
            ),
            wants_cover=insurance_opt_in,
        )
        subscription = Subscription(
            id=f"sub-{next(self._subscription_ids)}",
            cleaner_profile_id=cleaner.id,
            plan_name="starter",
            amount_gbp=39.0,
            insurance_add_on=bool(insurance_summary["eligible"]),
        )
        self.repositories.users.add(user.id, user)
        self.repositories.cleaner_profiles.add(cleaner.id, cleaner)
        self.repositories.subscriptions.add(subscription.id, subscription)
        return {
            "user": asdict(user),
            "cleaner_profile": asdict(cleaner),
            "subscription": asdict(subscription),
        }


class JobCreationService:
    def __init__(
        self,
        repositories: RepositoryBundle,
        geocoding_service: MapboxPostcodeGeocodingService,
        scoring_service: AILeadScoringService,
    ) -> None:
        self.repositories = repositories
        self.geocoding_service = geocoding_service
        self.scoring_service = scoring_service
        self._job_ids = count(1)
        self._offer_ids = count(1)

    def create_job(
        self,
        *,
        customer_name: str,
        postcode: str,
        service_type_code: str,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        service_type = self.repositories.service_types.get(service_type_code)
        if service_type is None:
            raise ValueError(f"Unknown service type: {service_type_code}")
        location = self.geocoding_service.geocode_postcode(postcode)
        job_metadata = {**(metadata or {}), "resolved_geocoding_mode": location["mode"]}
        job = Job(
            id=f"job-{next(self._job_ids)}",
            customer_name=customer_name,
            postcode=location["postcode"],
            service_type_code=service_type_code,
            latitude=location["latitude"],
            longitude=location["longitude"],
            metadata=job_metadata,
        )
        lead_score = self.scoring_service.score_job(job, service_type)
        job.lead_score = lead_score["score"]
        self.repositories.jobs.add(job.id, job)
        return {"job": asdict(job), "geocoding": location, "lead_score": lead_score}

    def create_job_offer(self, *, job_id: str, cleaner_profile_id: str) -> dict[str, object]:
        offer = JobOffer(
            id=f"offer-{next(self._offer_ids)}",
            job_id=job_id,
            cleaner_profile_id=cleaner_profile_id,
        )
        self.repositories.job_offers.add(offer.id, offer)
        return asdict(offer)


class SubscriptionBillingService:
    def preview_invoice(self, subscription: Subscription) -> dict[str, object]:
        line_items = [{"name": subscription.plan_name, "amount_gbp": subscription.amount_gbp}]
        if subscription.insurance_add_on:
            line_items.append({"name": "insurance_add_on", "amount_gbp": 19.99})
        total = round(sum(item["amount_gbp"] for item in line_items), 2)
        return {
            "subscription_id": subscription.id,
            "line_items": line_items,
            "total_gbp": total,
            "payment_provider": "placeholder-billing-adapter",
        }
