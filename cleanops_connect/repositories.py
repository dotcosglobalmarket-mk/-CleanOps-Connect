from __future__ import annotations

from dataclasses import dataclass, field
from typing import Generic, TypeVar

from .models import CleanerProfile, Job, JobOffer, ServiceType, Subscription, User

T = TypeVar("T")


class InMemoryRepository(Generic[T]):
    def __init__(self) -> None:
        self._records: dict[str, T] = {}

    def add(self, key: str, value: T) -> T:
        self._records[key] = value
        return value

    def get(self, key: str) -> T | None:
        return self._records.get(key)

    def list(self) -> list[T]:
        return list(self._records.values())


@dataclass(slots=True)
class RepositoryBundle:
    users: InMemoryRepository[User] = field(default_factory=InMemoryRepository)
    cleaner_profiles: InMemoryRepository[CleanerProfile] = field(default_factory=InMemoryRepository)
    jobs: InMemoryRepository[Job] = field(default_factory=InMemoryRepository)
    job_offers: InMemoryRepository[JobOffer] = field(default_factory=InMemoryRepository)
    service_types: InMemoryRepository[ServiceType] = field(default_factory=InMemoryRepository)
    subscriptions: InMemoryRepository[Subscription] = field(default_factory=InMemoryRepository)
