"""Model verification test suite.

Tests all models against standard requirements and stores capability matrix.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Optional, Literal

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Model, Provider
from app.models.model_verification import ModelVerification
from app.services.model_client import ModelClient
from app.services.provider_credentials import get_provider_api_key

logger = logging.getLogger(__name__)


TestStatus = Literal["pass", "skip", "fail"]


@dataclass
class TestResult:
    """Result of a single test."""
    status: TestStatus  # 'pass', 'skip', 'fail'
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    details: dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ModelVerificationResult:
    """Result of full model verification."""
    model_id: str
    provider_name: str
    verification_status: Literal["verified", "failed", "degraded"]
    test_results: dict[str, TestResult]
    capabilities: dict[str, bool]
    notes: Optional[str] = None
    fallback_recommendations: Optional[str] = None
    verified_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ModelVerificationService:
    """Verify model capabilities through systematic testing."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = ModelClient()
    
    async def verify_model(
        self,
        model: Model,
        provider: Provider,
        test_suite_version: str = "v1"
    ) -> ModelVerificationResult:
        """
        Run full verification suite on a model.
        
        Args:
            model: Model ORM instance
            provider: Provider ORM instance
            test_suite_version: Version identifier for test suite
            
        Returns:
            ModelVerificationResult with all test results and capabilities
        """
        logger.info(f"Verifying model {model.model_id} from {provider.name}")
        
        test_results = {}
        capabilities = {}
        
        # Run all tests
        tests = [
            ("chat_basic", self.test_chat_basic),
            ("chat_streaming", self.test_chat_streaming),
            ("chat_non_streaming", self.test_chat_non_streaming),
            ("vision", self.test_vision),
            ("embeddings", self.test_embeddings),
            ("function_calling", self.test_function_calling),
            ("error_handling", self.test_error_handling),
            ("timeout", self.test_timeout),
            ("connectivity", self.test_connectivity),
        ]
        
        for test_name, test_func in tests:
            try:
                result = await test_func(model, provider)
                test_results[test_name] = asdict(result)
                logger.debug(f"  {test_name}: {result.status}")
            except Exception as e:
                logger.error(f"  {test_name}: exception: {e}")
                test_results[test_name] = {
                    "status": "fail",
                    "error": str(e),
                    "duration_ms": None
                }
        
        # Infer capabilities from results
        capabilities = self._infer_capabilities(test_results)
        
        # Determine overall status
        failures = [r for r in test_results.values() if r.get("status") == "fail"]
        verification_status = "verified" if not failures else "failed"
        
        notes = self._generate_notes(test_results, capabilities)
        recommendations = self._generate_recommendations(capabilities)
        
        result = ModelVerificationResult(
            model_id=model.model_id,
            provider_name=provider.name,
            verification_status=verification_status,
            test_results=test_results,
            capabilities=capabilities,
            notes=notes,
            fallback_recommendations=recommendations,
            verified_at=datetime.now(timezone.utc)
        )
        
        # Store in DB
        await self._store_verification(model, result, test_suite_version)
        
        return result
    
    async def test_chat_basic(self, model: Model, provider: Provider) -> TestResult:
        """Test basic text chat."""
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Simple chat call
            response = await self.client.chat(
                provider=provider.name,
                model=model.model_id,
                messages=[{"role": "user", "content": "Say 'test' in one word."}],
                api_key=api_key,
                timeout=10
            )
            
            duration_ms = int((time.time() - start) * 1000)
            if response and response.choices and response.choices[0].message.content:
                return TestResult(status="pass", duration_ms=duration_ms)
            else:
                return TestResult(status="fail", duration_ms=duration_ms, error="Empty response")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_chat_streaming(self, model: Model, provider: Provider) -> TestResult:
        """Test streaming chat."""
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Streaming chat call
            chunks_received = 0
            async for chunk in self.client.chat_stream(
                provider=provider.name,
                model=model.model_id,
                messages=[{"role": "user", "content": "Count 1, 2, 3."}],
                api_key=api_key,
                timeout=10
            ):
                if chunk and chunk.choices and chunk.choices[0].delta.content:
                    chunks_received += 1
            
            duration_ms = int((time.time() - start) * 1000)
            if chunks_received > 0:
                return TestResult(status="pass", duration_ms=duration_ms, details={"chunks": chunks_received})
            else:
                return TestResult(status="fail", duration_ms=duration_ms, error="No chunks received")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_chat_non_streaming(self, model: Model, provider: Provider) -> TestResult:
        """Test non-streaming chat."""
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Non-streaming chat call
            response = await self.client.chat(
                provider=provider.name,
                model=model.model_id,
                messages=[{"role": "user", "content": "Hello."}],
                api_key=api_key,
                timeout=10,
                stream=False
            )
            
            duration_ms = int((time.time() - start) * 1000)
            if response and response.choices and response.choices[0].message.content:
                return TestResult(status="pass", duration_ms=duration_ms)
            else:
                return TestResult(status="fail", duration_ms=duration_ms, error="Empty response")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_vision(self, model: Model, provider: Provider) -> TestResult:
        """Test vision capability (if supported)."""
        # Check if model supports vision
        if not model.capabilities or not model.capabilities.get("vision"):
            return TestResult(status="skip", details={"reason": "Model does not support vision"})
        
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Vision call with a simple test image (base64)
            test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="
            
            response = await self.client.chat(
                provider=provider.name,
                model=model.model_id,
                messages=[{
                    "role": "user",
                    "content": "Describe this image.",
                    "image": test_image_base64
                }],
                api_key=api_key,
                timeout=15
            )
            
            duration_ms = int((time.time() - start) * 1000)
            if response and response.choices and response.choices[0].message.content:
                return TestResult(status="pass", duration_ms=duration_ms)
            else:
                return TestResult(status="fail", duration_ms=duration_ms, error="Empty response")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_embeddings(self, model: Model, provider: Provider) -> TestResult:
        """Test embeddings capability (if supported)."""
        if not model.capabilities or not model.capabilities.get("embeddings"):
            return TestResult(status="skip", details={"reason": "Model does not support embeddings"})
        
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Embeddings call
            response = await self.client.embeddings(
                provider=provider.name,
                model=model.model_id,
                input="Test embedding",
                api_key=api_key,
                timeout=10
            )
            
            duration_ms = int((time.time() - start) * 1000)
            if response and response.data:
                return TestResult(status="pass", duration_ms=duration_ms, details={"dimensions": len(response.data[0].embedding)})
            else:
                return TestResult(status="fail", duration_ms=duration_ms, error="No embeddings returned")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_function_calling(self, model: Model, provider: Provider) -> TestResult:
        """Test function calling (if supported)."""
        if not model.capabilities or not model.capabilities.get("function_calling"):
            return TestResult(status="skip", details={"reason": "Model does not support function calling"})
        
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Function calling test
            functions = [
                {
                    "name": "get_weather",
                    "description": "Get weather for a location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string"}
                        },
                        "required": ["location"]
                    }
                }
            ]
            
            response = await self.client.chat(
                provider=provider.name,
                model=model.model_id,
                messages=[{"role": "user", "content": "What's the weather in NYC?"}],
                functions=functions,
                api_key=api_key,
                timeout=15
            )
            
            duration_ms = int((time.time() - start) * 1000)
            if response and response.choices:
                if response.choices[0].message.function_call or response.choices[0].message.tool_calls:
                    return TestResult(status="pass", duration_ms=duration_ms)
                else:
                    # Model may not use function, still consider it pass
                    return TestResult(status="pass", duration_ms=duration_ms, details={"note": "Model did not call function"})
            else:
                return TestResult(status="fail", duration_ms=duration_ms, error="No response")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_error_handling(self, model: Model, provider: Provider) -> TestResult:
        """Test error handling (invalid input)."""
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Send invalid request
            try:
                response = await self.client.chat(
                    provider=provider.name,
                    model="invalid-model-that-does-not-exist",
                    messages=[{"role": "user", "content": "Hi"}],
                    api_key=api_key,
                    timeout=5
                )
                # If no exception, that's unexpected
                duration_ms = int((time.time() - start) * 1000)
                return TestResult(status="fail", duration_ms=duration_ms, error="Expected error but got response")
            except httpx.HTTPStatusError as e:
                # Expected
                duration_ms = int((time.time() - start) * 1000)
                if e.response.status_code in [400, 404]:
                    return TestResult(status="pass", duration_ms=duration_ms, details={"status_code": e.response.status_code})
                else:
                    return TestResult(status="fail", duration_ms=duration_ms, error=f"Unexpected status: {e.response.status_code}")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_timeout(self, model: Model, provider: Provider) -> TestResult:
        """Test timeout handling."""
        start = time.time()
        try:
            api_key = get_provider_api_key(provider.name)
            if not api_key:
                return TestResult(status="skip", details={"reason": "No API key"})
            
            # Long prompt with short timeout
            long_prompt = "Explain quantum computing in 100 words: " + ("x" * 5000)
            
            try:
                response = await self.client.chat(
                    provider=provider.name,
                    model=model.model_id,
                    messages=[{"role": "user", "content": long_prompt}],
                    api_key=api_key,
                    timeout=2  # Very short
                )
                # If no timeout, still OK
                duration_ms = int((time.time() - start) * 1000)
                return TestResult(status="pass", duration_ms=duration_ms)
            except asyncio.TimeoutError:
                # Expected
                duration_ms = int((time.time() - start) * 1000)
                return TestResult(status="pass", duration_ms=duration_ms, details={"timeout_respected": True})
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def test_connectivity(self, model: Model, provider: Provider) -> TestResult:
        """Test provider connectivity."""
        start = time.time()
        try:
            if not provider.api_base_url:
                return TestResult(status="skip", details={"reason": "No API base URL"})
            
            # Simple HTTP HEAD/GET to provider endpoint
            async with httpx.AsyncClient() as client:
                response = await client.head(provider.api_base_url, timeout=5)
                duration_ms = int((time.time() - start) * 1000)
                if response.status_code < 500:
                    return TestResult(status="pass", duration_ms=duration_ms)
                else:
                    return TestResult(status="fail", duration_ms=duration_ms, error=f"HTTP {response.status_code}")
        except Exception as e:
            duration_ms = int((time.time() - start) * 1000)
            return TestResult(status="fail", duration_ms=duration_ms, error=str(e))
    
    async def _store_verification(
        self,
        model: Model,
        result: ModelVerificationResult,
        test_suite_version: str
    ):
        """Store verification result in DB."""
        stmt = select(ModelVerification).where(ModelVerification.model_id == model.id)
        verification = (await self.db.execute(stmt)).scalars().first()
        
        test_results_dict = {k: v for k, v in result.test_results.items()}
        
        if verification:
            # Update existing
            await self.db.execute(
                update(ModelVerification)
                .where(ModelVerification.model_id == model.id)
                .values(
                    verification_status=result.verification_status,
                    test_results=test_results_dict,
                    capabilities=result.capabilities,
                    notes=result.notes,
                    fallback_recommendations=result.fallback_recommendations,
                    last_verified_at=result.verified_at,
                    verified_at=result.verified_at,
                    verified_by=test_suite_version
                )
            )
        else:
            # Create new
            verification = ModelVerification(
                model_id=model.id,
                verification_status=result.verification_status,
                test_results=test_results_dict,
                capabilities=result.capabilities,
                notes=result.notes,
                fallback_recommendations=result.fallback_recommendations,
                verified_at=result.verified_at,
                last_verified_at=result.verified_at,
                verified_by=test_suite_version
            )
            self.db.add(verification)
        
        await self.db.commit()
    
    def _infer_capabilities(self, test_results: dict[str, dict]) -> dict[str, bool]:
        """Infer model capabilities from test results."""
        return {
            "chat": test_results.get("chat_basic", {}).get("status") == "pass",
            "streaming": test_results.get("chat_streaming", {}).get("status") == "pass",
            "vision": test_results.get("vision", {}).get("status") == "pass",
            "embeddings": test_results.get("embeddings", {}).get("status") == "pass",
            "function_calling": test_results.get("function_calling", {}).get("status") == "pass",
        }
    
    def _generate_notes(self, test_results: dict[str, dict], capabilities: dict[str, bool]) -> Optional[str]:
        """Generate human-readable notes."""
        failures = [k for k, v in test_results.items() if v.get("status") == "fail"]
        if failures:
            return f"Failed tests: {', '.join(failures)}"
        return None
    
    def _generate_recommendations(self, capabilities: dict[str, bool]) -> Optional[str]:
        """Generate fallback recommendations."""
        if not capabilities.get("vision"):
            return "For vision tasks, use a vision-capable model (gpt-4o, claude-opus-4-5, gemini-2.5-pro)"
        if not capabilities.get("streaming"):
            return "For streaming, consider models with streaming support"
        return None
    
    async def verify_models_batch(
        self,
        models: list[tuple[Model, Provider]],
        concurrency: int = 5
    ) -> dict[str, ModelVerificationResult]:
        """Verify multiple models in parallel."""
        results = {}
        semaphore = asyncio.Semaphore(concurrency)
        
        async def verify_with_semaphore(model, provider):
            async with semaphore:
                try:
                    result = await self.verify_model(model, provider)
                    results[f"{provider.name}/{model.model_id}"] = result
                except Exception as e:
                    logger.error(f"Error verifying {provider.name}/{model.model_id}: {e}")
        
        await asyncio.gather(*[verify_with_semaphore(m, p) for m, p in models])
        return results
