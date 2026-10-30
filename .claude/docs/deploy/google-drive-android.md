# Blocking Google Drive on Android (deployment guide, FR-M1-53)

Applies to: CR-02 (Drive only on the allocated company PC) and CR-06 (everything else works on Android).
Audience: the tenant's Google Workspace administrator, with help from whoever deploys OpsDesk.

## Why two layers

OpsDesk hides Drive on any device that is not a trusted company PC: no Drive buttons, no previews, no downloads, and Drive links read "Available on your work PC". That only covers OpsDesk itself.
OpsDesk cannot stop someone opening the Drive app, or drive.google.com in a phone browser. Only Google can do that, so the Google Workspace admin must also block Drive on Android at Google's side. Without it, acceptance test AC-M1-07 does not pass.

Assumed (open questions Q1 to Q3): the company uses Google Workspace with admin access, staff use personal Android phones, each person has one company PC.

## Step 1: Register the PCs in OpsDesk

1. Settings, Devices: add each person's company PC. Type "Windows or Mac PC", owner "Company", allocated to that person, "Trusted" on.
2. Add their Android phone as type "Android phone", owner "Personal". It stays not trusted.
3. Settings, Integrations, Device access: set Google Drive to "Only on trusted company PCs".

## Step 2: Block Drive on phones at Google's side

Pick the option your Workspace edition supports. Check the edition first (Admin console, Billing, Subscriptions).

### Option A: Context-Aware Access (Enterprise and Education Plus, Business Plus on some plans)

1. Open the Admin console, Security, Access and data control, Context-Aware Access.
2. Create an access level called "Company PCs": condition on device, "Device is company-owned" or "Endpoint Verification: device policy compliant", and operating system Windows or macOS. Endpoint Verification must be installed on the PCs (Chrome extension), or use managed Chrome.
3. Assign the access level to the Google Drive and Docs app (and Google Workspace core services if you want Docs, Sheets and Slides too). Apply it to the organisational unit that holds the staff.
4. Choose "Block" for anyone who does not meet the level. Phones and unknown browsers lose access to Drive.

### Option B: Mobile device management rules (Business Standard and above)

1. Admin console, Devices, Mobile and endpoints, Settings, Universal settings, General: turn on advanced (or basic) mobile management for the staff organisational unit.
2. Devices, Mobile and endpoints, Settings, Android settings: require a work profile on personal phones. Work profile apps are managed separately.
3. Do not install or allow Google Drive in the work profile. Block it in the managed Google Play app list, so the personal side of the phone cannot reach company Drive data.
4. Under Apps, Google Workspace, Drive and Docs, Features and Applications: turn off "Allow users to access Drive from mobile devices" for that organisational unit where your edition shows this setting.

### Option C: Turn Drive off for a group (any edition, blunt)

If neither A nor B is available: Apps, Google Workspace, Drive and Docs, Sharing settings and Features, restrict the staff organisational unit to desktop use only where offered, and tell staff in writing that Drive is for the office PC only. This is a policy, not a block, so record that the client accepted the risk.

## Step 3: Check it works

1. On the company PC: open OpsDesk, then a task with a Drive link. The link opens. Open Drive itself: it works.
2. On a staff Android phone: OpsDesk works, the same task shows "Available on your work PC", and opening the Drive app or drive.google.com shows an access-blocked message (AC-M1-07).
3. In an unregistered browser: same as the phone.
4. Admin console, Reporting, Audit and investigation, Drive log events: confirm blocked attempts appear.

## Keeping it right

- New starter: register their PC in OpsDesk and add them to the organisational unit that has the access level.
- Lost or replaced PC: remove it in Settings, Devices; remove the device in the Admin console.
- Leaver: deactivate the user in both places.
- Review the register each quarter. A PC that is "trusted" in OpsDesk but not compliant at Google (or the other way round) is a mismatch.
