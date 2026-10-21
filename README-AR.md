# Shokr Tracker — متابعة الخصم والميني باك

## المميزات
- واجهة عربية RTL مناسبة للموبايل.
- الخصم: الموعد القادم بعد 34 يومًا من تاريخ آخر عملية.
- الميني: الموعد القادم في نفس رقم اليوم من الشهر التالي، وإذا لم يوجد اليوم (مثل 31 فبراير) يستخدم آخر يوم في الشهر.
- إضافة/تعديل/حذف أرقام، تسجيل العملية، بحث، فلاتر، وتصدير CSV.
- Firebase Authentication + Cloud Firestore، مع فصل بيانات كل حساب عن الآخر بقواعد أمان.

## قبل النشر
1. أنشئ مشروعًا في https://console.firebase.google.com/
2. Authentication → Sign-in method → فعّل Email/Password.
3. أنشئ Firestore Database. ابدأ بوضع قواعد `firestore.rules` في تبويب Rules ثم Publish.
4. Project settings → General → Your apps → Add app (Web) وسجّل تطبيق ويب.
5. انسخ إعدادات `firebaseConfig` التي يعرضها Firebase، وافتح `index.html` واستبدل:
   - `PASTE_FIREBASE_API_KEY`
   - `PASTE_PROJECT_ID` في authDomain وprojectId
   - `PASTE_FIREBASE_APP_ID`
   بالقيم الفعلية التي أعطاها Firebase. إذا كان Firebase يعرض `messagingSenderId` أو `storageBucket`، يمكن إضافتهما، لكن التطبيق لا يحتاجهما.
6. انشر `index.html` و`firestore.rules` في مستودع GitHub عام باسم `Shokr-Tracker`.
7. في GitHub: Settings → Pages → Deploy from a branch → `main` → `/(root)` → Save.
8. افتح رابط Pages. أول مرة أنشئ حسابك ببريدك وكلمة مرور قوية. بيانات كل حساب معزولة عبر قواعد Firestore.

## ملاحظات
- إعدادات Firebase الخاصة بتطبيق الويب ليست كلمات مرور إدارية؛ الحماية الفعلية تعتمد على Authentication وقواعد Firestore.
- لا تضع service-account JSON أو مفاتيح خادم في ملفات الموقع.
- النسخة الحالية تحفظ تاريخ آخر عملية فقط لكل رقم. زر «تمت العملية» يضبط آخر عملية على تاريخ اليوم، ثم يحسب الموعد القادم.
- راجع دائمًا قواعد Firestore قبل إدخال بيانات حقيقية.
