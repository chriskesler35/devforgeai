# DevForgeAI Plugin Manager CLI

The DevForgeAI CLI provides command-line tools for managing AI model providers and verifying their health and capabilities.

## Installation

```bash
# The CLI is available as a Python script in the DevForgeAI root directory
python devforgeai-cli.py --help
```

Or, create an alias for easier access:

```bash
# Windows (PowerShell)
Set-Alias -Name devforgeai -Value "python g:\Model_Mesh\devforgeai-cli.py" -Scope CurrentUser

# Linux/macOS
alias devforgeai='python /path/to/devforgeai-cli.py'
```

## Commands

### `devforgeai plugins list`

List all installed providers and their model counts.

**Output:**
```
Provider              Models  Health    Verified
─────────────────────────────────────────────────
OpenAI                  8      ✓ ok      7
Anthropic               4      ✓ ok      4
Google Gemini           3      ✓ ok      3
Ollama (local)          2      ? unchecked  0
OpenRouter             12      ✗ failed   2
```

**Options:**
- `--json`: Output JSON instead of table

### `devforgeai plugins install [provider]`

Install and configure a new provider.

**Usage:**
```bash
devforgeai plugins install openai
devforgeai plugins install anthropic --api-key sk-ant-...
devforgeai plugins install google
```

**Process:**
1. Prompts for provider API key (if not provided)
2. Tests credential validity
3. Syncs available models from provider
4. Optionally runs verification tests

**Options:**
- `--api-key`: Provide API key directly (skips prompt)
- `--no-verify`: Skip verification tests after install

**Example:**
```bash
$ devforgeai plugins install openai --api-key sk-proj-xxx
Connecting to OpenAI...
✓ Credentials valid
✓ Found 40 models
Syncing models...
✓ Added 8 new models (32 duplicate)
Run 'devforgeai plugins verify openai' to test capabilities
```

### `devforgeai plugins health [provider]`

Check the health and connectivity of a provider.

**Usage:**
```bash
devforgeai plugins health openai
devforgeai plugins health  # Check all providers
```

**Output:**
```
Provider: OpenAI
Credential Status:      ✓ valid
Connectivity:           ✓ ok
Rate Limit Remaining:   3,500 / 3,500 requests
Last Check:             2 minutes ago (148ms)
Message:                All systems operational
```

**Options:**
- `--verbose`: Show detailed error messages
- `--json`: Output JSON instead of text

### `devforgeai plugins verify [provider]`

Run comprehensive verification tests on models from a provider.

**Usage:**
```bash
devforgeai plugins verify openai       # Verify all OpenAI models
devforgeai plugins verify google       # Verify all Google models
devforgeai plugins verify              # Verify all providers
```

**Tests Performed:**
- ✓ Basic chat capability
- ✓ Streaming responses
- ✓ Non-streaming responses
- ✓ Vision capability (if supported)
- ✓ Embeddings capability (if supported)
- ✓ Function calling support
- ✓ Error handling
- ✓ Timeout behavior
- ✓ Connectivity

**Output:**
```
Provider: OpenAI
────────────────────────────────────────────
gpt-4o                  ✓ verified (8/9 tests passed)
gpt-4-turbo             ✓ verified (8/9 tests passed)
gpt-3.5-turbo           ✓ verified (8/9 tests passed)
o1-mini                 ⚠ degraded (7/9 tests passed) [No vision]
dall-e-3                ✗ failed   (0/9 tests passed) [Not a chat model]

Summary: 3 verified, 1 degraded, 1 failed
Recommendations:
  • Use gpt-4o for vision tasks
  • Use o1-mini for reasoning (note: no vision)
  • Replace dall-e-3 with gpt-4o for image generation
```

**Options:**
- `--concurrency`: Number of parallel test workers (default: 5)
- `--json`: Output JSON with detailed test results
- `--feature`: Test only models supporting a specific feature (vision, streaming, functions, etc.)

### `devforgeai plugins configure [provider]`

Update provider credentials and re-test connectivity.

**Usage:**
```bash
devforgeai plugins configure openai     # Interactive credential update
devforgeai plugins configure openai --api-key sk-proj-xxx --no-verify
```

**Process:**
1. Prompts for new API key (interactive or via --api-key)
2. Tests credential validity
3. Optionally runs health check

**Options:**
- `--api-key`: Provide API key directly (skips prompt)
- `--no-verify`: Skip health check after update

## Features

### Credential Management
- **Secure storage**: API keys stored in environment or system keyring
- **Validation**: Credentials tested before being saved
- **Per-provider auth**: Supports different auth schemes (Bearer, X-API-Key, etc.)

### Model Verification
- **9-test suite**: Comprehensive capability testing
- **Capability matrix**: Models tagged with supported features
- **Degradation detection**: Models with partial failures flagged
- **Recommendations**: Fallback suggestions for each model

### Health Monitoring
- **Credential health**: Validates API key validity
- **Connectivity health**: Tests provider API reachability
- **Rate limits**: Reports remaining quota and reset times
- **Background monitoring**: Periodic health checks (configurable)

### User Control
- **Model pinning**: Pin preferred models for specific features
- **Fallback chains**: Define ordered lists of fallback models
- **Feature-driven selection**: Runtime automatically selects models by capability

## Examples

### Complete Setup Flow
```bash
# Install first provider
devforgeai plugins install openai --api-key sk-proj-xxx

# Check health
devforgeai plugins health openai

# Verify capabilities
devforgeai plugins verify openai

# List all providers
devforgeai plugins list

# Install second provider
devforgeai plugins install anthropic

# Verify all at once
devforgeai plugins verify

# Check overall health
devforgeai plugins health
```

### Troubleshooting
```bash
# Check if provider is reachable
devforgeai plugins health openai --verbose

# Re-verify a specific provider after fixing API key
devforgeai plugins configure openai --no-verify

# Get detailed test results in JSON
devforgeai plugins verify openai --json
```

## Environment Variables

```bash
# API Keys (set in .env or environment)
OPENAI_API_KEY=sk-proj-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
GOOGLE_API_KEY=xxx
OPENROUTER_API_KEY=sk-or-xxx
OLLAMA_BASE_URL=http://localhost:11434

# Health Check Configuration
MODEL_HEALTH_CHECK_INTERVAL_SECONDS=300  # Default: 5 minutes
MODEL_VERIFICATION_TIMEOUT_SECONDS=30     # Default: 30 seconds
MODEL_VERIFICATION_CONCURRENCY=5           # Default: 5 parallel tests

# Strict Mode (requires verification)
MODEL_STRICT_VALIDATION_REQUIRED=1
```

## Database Schema

The CLI uses two tables for tracking model health:

### `model_verifications`
- `model_id`: UUID reference to model
- `verification_status`: verified | failed | degraded
- `test_results`: JSONB with individual test outcomes
- `capabilities`: JSONB with feature matrix (chat, vision, streaming, etc.)
- `verified_at`: Timestamp of last verification
- `fallback_recommendations`: Suggestions for model replacement

### `provider_health`
- `provider_id`: UUID reference to provider
- `health_status`: ok | degraded | failed
- `credential_status`: valid | invalid | unchecked
- `connectivity_status`: ok | error | unchecked
- `rate_limit_remaining`: Current quota
- `rate_limit_reset_at`: When quota resets
- `last_checked_at`: Timestamp of last health check

## API Integration

All CLI commands map to REST endpoints:

```
GET    /v1/models/{model_id}/verification          # Get verification status
POST   /v1/models/{model_id}/verify                 # Manually trigger verification
POST   /v1/models/verify-all                        # Regression test all models
GET    /v1/models/health-dashboard                  # Real-time health metrics
GET    /v1/providers/{provider_id}/health           # Get provider health
POST   /v1/providers/{provider_id}/health/check     # Manually trigger health check
GET    /v1/providers/health/all                     # All provider health status
PUT    /v1/providers/{provider_id}/credential       # Update API key + test
```

## Best Practices

1. **Install and verify** providers during setup:
   ```bash
   devforgeai plugins install openai && devforgeai plugins verify openai
   ```

2. **Pin preferred models** by updating database:
   ```bash
   UPDATE models SET is_pinned_default=true WHERE model_id='gpt-4o';
   ```

3. **Monitor health regularly**:
   ```bash
   # Set up a cron job or scheduled task
   devforgeai plugins health
   ```

4. **Re-verify before major releases**:
   ```bash
   devforgeai plugins verify-all
   ```

5. **Check degraded models** and update fallback chains:
   ```bash
   # After running verify, inspect the recommendations
   ```

## Troubleshooting

### "Credential invalid" error
```bash
# Update credentials
devforgeai plugins configure openai --api-key sk-proj-xxx
```

### "Connection refused" error
```bash
# Check provider connectivity
devforgeai plugins health openai --verbose

# May need to:
# - Check network connectivity
# - Disable VPN/proxy
# - Verify firewall rules
```

### "Model not found" after sync
```bash
# Re-sync models from provider
devforgeai plugins install openai --no-verify
```

### Health check hanging
```bash
# Check timeout settings
export MODEL_VERIFICATION_TIMEOUT_SECONDS=10
devforgeai plugins verify openai --concurrency 1
```

## Future Enhancements

- [ ] Interactive provider selection UI
- [ ] Model benchmarking suite (performance, latency, cost)
- [ ] Cost tracking per provider
- [ ] Automatic model selection based on task (cost vs quality)
- [ ] Web dashboard for provider management
- [ ] Slack/Teams notifications for provider failures
