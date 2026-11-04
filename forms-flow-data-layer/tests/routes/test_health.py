"""Tests for the /health checks."""

from src.routes.health import HealthCheck


class FakeSession:
    """Mimics AsyncSession: an async context manager that is not awaitable."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement):
        return None


class FakeSqlDb:
    """Mimics ConnectSQLDatabase.get_session(), which is synchronous."""

    def get_session(self):
        return FakeSession()


class FakeMongoDb:
    async def ping(self):
        return {"ok": 1}


class FakeRedisClient:
    async def ping(self):
        return True


class FakeRedisCache:
    redis = FakeRedisClient()


async def test_check_webapi_connected():
    assert await HealthCheck.check_webapi(FakeSqlDb()) == "connected"


async def test_check_bpmn_connected():
    assert await HealthCheck.check_bpmn(FakeSqlDb()) == "connected"


async def test_health_check_all_connected_is_healthy():
    result = await HealthCheck.health_check(
        formio_db=FakeMongoDb(),
        bpmn_db=FakeSqlDb(),
        webapi_db=FakeSqlDb(),
        redis_cache=FakeRedisCache(),
    )
    assert result == {
        "status": "healthy",
        "components": {
            "formio": "connected",
            "cache": "connected",
            "webapi": "connected",
            "bpmn": "connected",
        },
    }
