import unittest

from cleanops_connect import create_application
from cleanops_connect.models import CleanerProfile


class BackendScaffoldTests(unittest.TestCase):
    def test_application_bootstraps_seeded_modules(self):
        app = create_application(mapbox_token="test-token")

        self.assertEqual(app.controllers["platform"].health()["status"], "ok")
        self.assertIn("domestic-standard", [service.code for service in app.repositories.service_types.list()])
        geocode = app.services["mapbox_geocoding"].geocode_postcode("SW1A 1AA")
        self.assertTrue(geocode["configured"])
        self.assertEqual(geocode["provider"], "mapbox")
        self.assertEqual(geocode["mode"], "live")

    def test_onboarding_job_creation_and_billing_placeholders(self):
        app = create_application()

        onboarding = app.controllers["cleaners"].onboard(
            {
                "email": "cleaner@example.com",
                "postcode": "M1 1AE",
                "business_name": "Sparkle Works",
                "service_type_codes": ["industrial-deep-clean"],
                "insurance_opt_in": False,
                "compliance_checks": {"dbs": True, "coshh": True},
            }
        )
        self.assertTrue(onboarding["cleaner_profile"]["is_onboarded"])
        self.assertTrue(onboarding["subscription"]["insurance_add_on"])

        job_result = app.controllers["jobs"].create(
            {
                "customer_name": "Factory Site",
                "postcode": "M1 1AE",
                "service_type_code": "industrial-deep-clean",
                "metadata": {"urgent": True, "recurring": True},
            }
        )
        self.assertGreaterEqual(job_result["lead_score"]["score"], 80)
        self.assertEqual(job_result["geocoding"]["mode"], "placeholder")
        self.assertEqual(job_result["job"]["metadata"]["geocoding_mode"], "placeholder")

        subscription = app.repositories.subscriptions.get(onboarding["subscription"]["id"])
        preview = app.controllers["subscriptions"].preview_billing(subscription)
        self.assertEqual(preview["total_gbp"], 58.99)

        no_add_on_subscription = app.repositories.subscriptions.get(onboarding["subscription"]["id"])
        no_add_on_subscription.insurance_add_on = False
        no_add_on_preview = app.controllers["subscriptions"].preview_billing(no_add_on_subscription)
        self.assertEqual(no_add_on_preview["line_items"], [{"name": "starter", "amount_gbp": 39.0}])
        self.assertEqual(no_add_on_preview["total_gbp"], 39.0)

    def test_spatial_filtering_supports_coordinate_and_postcode_matches(self):
        app = create_application()
        job_result = app.controllers["jobs"].create(
            {
                "customer_name": "Townhouse",
                "postcode": "L1 8JQ",
                "service_type_code": "domestic-standard",
            }
        )
        job = app.repositories.jobs.get(job_result["job"]["id"])

        coordinate_match = CleanerProfile(
            id="cleaner-geo",
            user_id="user-geo",
            business_name="Geo Clean",
            service_type_codes=["domestic-standard"],
            latitude=job.latitude,
            longitude=job.longitude,
        )
        postcode_match = CleanerProfile(
            id="cleaner-postcode",
            user_id="user-postcode",
            business_name="Local Clean",
            service_type_codes=["domestic-standard"],
            coverage_postcodes=["L1 1AA"],
        )
        wrong_service_type = CleanerProfile(
            id="cleaner-wrong-service",
            user_id="user-wrong-service",
            business_name="Industrial Only",
            service_type_codes=["industrial-deep-clean"],
            coverage_postcodes=["L1 1AA"],
        )
        misses = CleanerProfile(
            id="cleaner-miss",
            user_id="user-miss",
            business_name="Far Away",
            service_type_codes=["domestic-standard"],
            coverage_postcodes=["EC1A 1BB"],
        )

        matches = app.services["spatial_filtering"].filter_cleaners(
            job,
            [coordinate_match, postcode_match, wrong_service_type, misses],
        )
        self.assertEqual([cleaner.id for cleaner in matches], ["cleaner-geo", "cleaner-postcode"])


if __name__ == "__main__":
    unittest.main()
