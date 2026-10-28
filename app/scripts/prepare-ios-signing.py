"""Validate an App Store profile for this staging app; write Xcode's signing/export settings.
No credentials or profile contents are printed. This script does not contact Apple.
"""
import datetime
import os
import pathlib
import plistlib
import re

root = pathlib.Path(os.environ['RUNNER_TEMP'])
team = os.environ['TEAM']
if not re.fullmatch(r'[A-Z0-9]{10}', team):
    raise SystemExit('Invalid Apple team identifier')
with (root / 'profile.plist').open('rb') as f:
    profile = plistlib.load(f)
entitlements = profile.get('Entitlements', {})
bundle = 'io.cyberjudah.app.staging'
if entitlements.get('application-identifier') != f'{team}.{bundle}':
    raise SystemExit('The provisioning profile does not belong to the staging app and selected team')
if team not in profile.get('TeamIdentifier', []):
    raise SystemExit('The profile team does not match')
if profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices') or entitlements.get('get-task-allow'):
    raise SystemExit('Use an App Store distribution profile for TestFlight')
expiry = profile.get('ExpirationDate')
if not isinstance(expiry, datetime.datetime) or expiry.replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit('The provisioning profile has expired')
uuid = profile.get('UUID', '')
if not re.fullmatch(r'[A-Fa-f0-9-]{36}', uuid):
    raise SystemExit('The profile UUID is invalid')
(root / 'signing.xcconfig').write_text(f'DEVELOPMENT_TEAM = {team}\nCODE_SIGN_STYLE = Manual\nCODE_SIGN_IDENTITY = Apple Distribution\nPROVISIONING_PROFILE_SPECIFIER = {uuid}\n')
with (root / 'export.plist').open('wb') as f:
    plistlib.dump({'method': 'app-store-connect', 'destination': 'export', 'teamID': team,
                  'signingStyle': 'manual', 'signingCertificate': 'Apple Distribution',
                  'provisioningProfiles': {bundle: uuid}, 'manageAppVersionAndBuildNumber': False,
                  'testFlightInternalTestingOnly': True}, f)
print('Validated the staging App Store provisioning profile')
