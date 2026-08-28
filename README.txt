Control and monitor your Leapmotor directly from Homey. No intermediary server, the app talks to Leapmotor's cloud the same way the official mobile app does. Your car becomes a first-class citizen in your flows: it reports what it is doing, and it does what you ask.

What you get: 

	92  Flow cards		42 actions, 17 conditions, 33 triggers
	39  remote commands	plus a raw command card for anything not wrapped yet
	45  capabilities	18 controls and 27 live readings on the device tile
	80  vehicle signals	decoded from the raw status feed

Highlights:  SOC with 0.1% precision, custom range, unlimited geofencing (latitude/longitude), plug type detection (CCS / Type 2), battery temperature, battery heating, etc.


IDEAS TO GET YOU STARTED

- Garage door opens: unlock the car (your Bluetooth key doesn't work either, right?)
- CCS cable detected: send a notification at every 10% SOC step while fast charging
- Bathroom motion after 6:00 on a workday + below 4C outside: start the defrost
- Build your own geofencing from the latitude/longitude
- Advanced charging plans around your energy tariff


SETUP: USE A SECOND ACCOUNT

Do not log into homey with your main Leapmotor account. Leapmotor can block unofficial access without warning, and you do not want to lose the app that opens your car.

  1. Create a NEW Leapmotor account in the Leapmotor mobile app. Use a second
     phone or tablet if you have one - the app can be removed afterwards.
     No spare device? Log out of your own Leapmotor app, create the new
     account there, then log back in with your main account.
  2. In the Leapmotor app with your MAIN account:
     Personal Center > My vehicle > tap your vehicle > Shared member >
     Add shared member, and give it the permissions you want Homey to have.
  3. Accept the shared vehicle on the second account.
  4. Add the vehicle in Homey using the second account.

The PIN is optional. Leave it blank and the app is read-only, all the sensor data, none of the remote commands. Fill it in and the commands unlock.


BEFORE YOU START - PLEASE READ

- Unofficial and unsupported. It uses a non-official API that can change, break or behave unpredictably at any time. Verify in a safe environment what it does before you rely on it. 
- Rate limits are real. Too much polling or too many commands can get an account temporarily blocked. Keep it reasonable.
- You are in charge. You accept responsibility for anything that follows vehicle damage, accidents, account locks or data issues.


KNOWN LIMITS AND HONEST SMALL PRINT

- Tested on a B10. Other models (B05, C10, T03, C16) should work but may have per-vehicle quirks
- The Leapmotor cryptography is heavy for older Homeys. On an early-2016 Homey it works, but it can hiccup if you ask it to do several things at once. Give commands a moment to breathe.
- Not everything works on every vehicle: seat adjustment, sentry, restarting the Bluetooth key are the usual suspects.
- Some API functions are deliberately not implemented: autopark, summon & Co are not available on export models. If you know the cmdId you can still fire them with the raw command card.


Hope it makes your life easier. Spent way too many days building it, will rest now.