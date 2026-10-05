# RFF Verify (Discord + Roblox)

Redirect URL (Discord developer portal):
- Discord: {BASE_URL}/auth/discord/callback

Roblox: if ROBLOX_ID is empty, users verify with a code in their profile About section (no Roblox app).
If you register a Roblox OAuth app, add {BASE_URL}/auth/roblox/callback (scopes: openid, profile) and fill ROBLOX_ID/ROBLOX_SECRET.

Run locally:
    npm install
    export $(grep -v '^#' .env | xargs)   # after copying .env.example to .env
    npm start

Then in your Discord server run /verify-panel in the verification channel.
Bot role must be ABOVE the Verified role and have Manage Roles + Manage Nicknames.
