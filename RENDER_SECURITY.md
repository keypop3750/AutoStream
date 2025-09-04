# Render Security Configuration

## Environment Variables for Security

Set these environment variables in your Render dashboard to protect ALL addon versions:

### Required Security Settings

```bash
# Force secure mode (recommended for production)
FORCE_SECURE_MODE=true

# Block environment credential usage (recommended)
BLOCK_ENV_CREDENTIALS=true

# Production environment
NODE_ENV=production
```

### Security Features

1. **Environment Variable Blocking**
   - `BLOCK_ENV_CREDENTIALS=true` prevents any environment variable credentials from being used
   - Protects against accidental credential sharing
   - Affects ALL addon versions connecting to this server

2. **Force Secure Mode**
   - `FORCE_SECURE_MODE=true` enforces strict security policies
   - Only user-provided API keys are allowed
   - No fallbacks to environment variables whatsoever

3. **Production Mode**
   - `NODE_ENV=production` enables additional production security measures
   - Automatic secure mode activation

## How This Protects ALL Users

Even users with old addon versions (pre-security fix) are protected because:

- **Server-side enforcement**: Security is enforced on Render, not in the addon
- **Universal coverage**: ALL requests go through the same Render server
- **Immediate effect**: Changes take effect as soon as you deploy to Render
- **No user action required**: Users don't need to update their addons

## Deployment Steps

1. Set environment variables in Render dashboard:
   ```
   FORCE_SECURE_MODE=true
   BLOCK_ENV_CREDENTIALS=true
   NODE_ENV=production
   ```

2. Deploy this code to Render

3. Verify security logs show protection is active:
   ```
   🔒 SECURE MODE: Environment credential fallbacks disabled
   🔒 RENDER SECURITY: Protection active for all addon versions
   ```

## Emergency Security

If you ever need to emergency-disable all debrid features:

```bash
# Emergency: Disable all debrid processing
EMERGENCY_DISABLE_DEBRID=true
```

This will force all users to non-debrid mode until you remove this variable.
