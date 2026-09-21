#!/usr/bin/env python3
"""The admin panel's API fixtures, in ONE place.

find-admin-untranslated.py (the sweep) and test-admin-i18n.py (the standing
test) both drive the built panel and both need every tab to actually paint --
an empty tab measures nothing, which this project has now been caught by
three times (the ledger pill's Failed/Paid, the founder Sign Up wording, the
activity ticker's own verbs). Two copies of these fixtures would drift, and
the drift would show up as a screen quietly no longer being covered.
"""
# Derived, never written down. This module is the reason two admin harnesses
# kept stubbing a host the panel no longer called: its name uses an
# UNDERSCORE, so the find-*.py glob that migrated every other harness never
# matched it. The rule was right and the glob was wrong.
from chipz_test_api import API

# ── fixtures rich enough that every tab actually paints ───────────────────
REGIONS = [
    {"key": "ug", "name": "Uganda", "currency": "UGX", "dialCode": "256", "localLength": 9,
     "prefixes": ["7"], "utcOffsetMin": 180, "hosts": [], "labels": ["g26e"], "active": True,
     "isDefault": True, "languages": ["en", "lg", "sw", "fr", "rw", "nyn"], "defaultLang": "en",
     "resolvedHosts": ["g26e.chipz-platform.com"]},
    {"key": "ke", "name": "Kenya", "currency": "KES", "dialCode": "254", "localLength": 9,
     "prefixes": ["7"], "utcOffsetMin": 180, "hosts": [], "labels": ["b5dh"], "active": True,
     "isDefault": False, "languages": ["en", "sw"], "defaultLang": "sw",
     "resolvedHosts": ["b5dh.chipz-platform.com"]},
]

USERS = [
    {"uid": "u1", "phone": "0742730382", "referralCode": "UG7Q4X", "walletBalance": 128500,
     "totalInvested": 120000, "totalDeposited": 200000, "totalEarned": 31000,
     "banned": False, "publicId": "00042", "createdAt": "2026-09-01T10:00:00Z",
     "regionKey": "ug", "registrationDone": True},
    {"uid": "u2", "phone": "0771220399", "referralCode": "UG2M9P", "walletBalance": 0,
     "totalInvested": 0, "totalDeposited": 0, "totalEarned": 0,
     "banned": True, "publicId": "00043", "createdAt": "2026-09-13T08:30:00Z",
     "regionKey": "ug", "registrationDone": False},
]

DEPOSITS = [
    {"id": "d1", "userId": "u1", "phone": "0742730382", "amount": 50000, "status": "pending",
     "method": "manual", "network": "mtn", "createdAt": "2026-09-12T14:02:00Z", "regionKey": "ug",
     "pastedSms": "You have received UGX 50,000 from 0742730382. Txn ID 1234567890.",
     "pastedSmsParsed": True, "assignedNumber": "0770000001", "assignedName": "John Doe"},
    {"id": "d2", "userId": "u1", "phone": "0742730382", "amount": 30000, "status": "completed",
     "method": "marzpay", "createdAt": "2026-09-11T09:00:00Z", "regionKey": "ug"},
    {"id": "d3", "userId": "u2", "phone": "0771220399", "amount": 90000, "status": "review",
     "method": "manual", "network": "airtel", "createdAt": "2026-09-13T10:00:00Z", "regionKey": "ug",
     "pastedSms": "random text that is not a payment message", "pastedSmsParsed": False},
    {"id": "d4", "userId": "u2", "phone": "0771220399", "amount": 20000, "status": "failed",
     "method": "marzpay", "createdAt": "2026-09-13T11:00:00Z", "regionKey": "ug",
     "failureReason": "Could not start the payment",
     "providerDetail": '{"status":"error","error_code":"SERVICE_NOT_FOUND","message":"Service not found."}'},
]

WITHDRAWALS = [
    {"id": "w1", "userId": "u1", "phone": "0742730382", "amount": 20000, "fee": 3000,
     "netAmount": 17000, "status": "pending", "accountNumber": "0742730382",
     "accountName": "John Doe", "provider": "MTN Mobile Money",
     "createdAt": "2026-09-13T09:41:00Z", "regionKey": "ug"},
    {"id": "w2", "userId": "u1", "phone": "0742730382", "amount": 25000, "fee": 3750,
     "netAmount": 21250, "status": "processed", "accountNumber": "0742730382",
     "accountName": "John Doe", "provider": "MTN Mobile Money",
     "createdAt": "2026-09-13T11:30:00Z", "regionKey": "ug"},
    {"id": "w3", "userId": "u2", "phone": "0771220399", "amount": 30000, "fee": 4500,
     "netAmount": 25500, "status": "rejected", "accountNumber": "0771220399",
     "accountName": "Jane Doe", "provider": "Airtel Money",
     "createdAt": "2026-09-13T12:00:00Z", "regionKey": "ug"},
]

TRANSACTIONS = [
    {"id": "t1", "userId": "u1", "phone": "0742730382", "type": "deposit", "amount": 50000,
     "description": "Deposit: Paid", "createdAt": "2026-09-12T14:02:00Z", "regionKey": "ug"},
    {"id": "t2", "userId": "u1", "phone": "0742730382", "type": "withdraw", "amount": -20000,
     "description": "Withdrawal: Processing", "createdAt": "2026-09-13T09:41:00Z", "regionKey": "ug"},
    {"id": "t3", "userId": "u1", "phone": "0742730382", "type": "l1_commission", "amount": 8100,
     "description": "L1 commission", "createdAt": "2026-09-02T11:20:00Z", "regionKey": "ug"},
    {"id": "t4", "userId": "u1", "phone": "0742730382", "type": "turntable", "amount": 700,
     "description": "Turntable win", "createdAt": "2026-09-14T07:15:00Z", "regionKey": "ug"},
]

REFERRALS = [
    {"id": "r1", "referrerPhone": "0742730382", "referredPhone": "0771220399", "level": 1,
     "amount": 8100, "investAmount": 30000, "createdAt": "2026-09-02T11:20:00Z", "regionKey": "ug"},
]

PRODUCTS = [
    {"key": "product-1", "name": "Product-1", "price": 30000, "cycle": 150, "cycleDays": 150,
     "expectedReturn": 900000, "image": "", "active": True, "order": 1,
     "spinCount": 2, "spinMin": 200, "spinMax": 1000},
    {"key": "product-2", "name": "Product-2", "price": 90000, "cycle": 150, "cycleDays": 150,
     "expectedReturn": 2700000, "image": "", "active": False, "order": 2,
     "spinCount": 0, "spinMin": 0, "spinMax": 0, "comingSoon": True},
]

SETTINGS = {
    "minDeposit": 30000, "minWithdraw": 20000, "maxWithdraw": 1000000, "withdrawFeePct": 15,
    "withdrawMultiple": 5000, "commL1": 27, "commL2": 2, "commL3": 1, "dailyCheckin": 500,
    "welcomeBonus": 7000, "returnMultiple": 30, "cycleDays": 150, "maxWithdrawalsPerDay": 1,
    "annEnabled": True, "annTitle": "Welcome", "annBody": "Welcome to the app.",
    "depositPayAEnabled": True, "depositPayBEnabled": True, "maintenanceMode": False,
    "maintenanceMsg": "", "openingCountdownEnabled": False, "openingCountdownAt": None,
    "brandName": "Chipz", "baseDomain": "chipz-platform.com", "blockRootDomain": True,
    "parkedHosts": "", "strictRegionHosts": False, "allowedOrigins": "",
    "turntableEnabled": True, "turntableDailyMin": 200, "turntableDailyMax": 1000,
    "withdrawWindowEnabled": True, "withdrawOpenFrom": "06:00", "withdrawOpenTo": "17:00",
    "requireReferralCode": True, "requireInvestToWithdraw": False,
    "manualSmsAutoCredit": False, "rotateEntry": "off",
    "autoApproveWithdrawals": False, "authHeroOpacity": 45, "authCardOpacity": 25,
    "authHeroBlur": 6, "authCardBlur": 4,
}

STATS = {"status": "success", "regionKey": "ug", "truncated": False,
         "moneyByRegion": [{"regionKey": "ug", "currency": "UGX", "walletTotal": 128500,
                            "depositAmount": 200000, "withdrawAmount": 20000,
                            "investedAmount": 120000}],
         "stats": {"totalUsers": 2, "activeUsers": 1, "bannedUsers": 1, "walletTotal": 128500,
                   "depositAmount": 200000, "withdrawAmount": 20000, "investedAmount": 120000,
                   "activeInvestments": 1, "pendingDepCount": 1, "pendingWitCount": 1}}

ANALYTICS = {"status": "success", "regionKey": "ug",
             "days": [{"day": "2026-09-13", "deposits": 50000, "withdrawals": 20000,
                       "signups": 1, "investments": 30000}],
             "totals": {"deposits": 200000, "withdrawals": 20000, "signups": 2,
                        "investments": 120000},
             "topReferrers": [{"phone": "0742730382", "count": 2, "earned": 8100}]}

R = {
    "/admin/check-key": {"status": "success", "token": "t", "username": "owner", "role": "owner"},
    "/admin/settings": {"status": "success", "settings": SETTINGS, "overrides": []},
    "/admin/products": {"status": "success", "products": PRODUCTS, "overrides": []},
    "/admin/regions": {"status": "success", "regions": REGIONS, "baseDomain": "chipz-platform.com"},
    "/admin/users": {"status": "success", "users": USERS, "count": len(USERS), "regionKey": "ug"},
    "/admin/stats": STATS,
    "/admin/analytics": ANALYTICS,
    "/admin/analytics/abuse": {"status": "success", "flags": []},
    "/admin/badges": {"status": "success", "pendingDeposits": 1, "pendingWithdrawals": 1},
    "/admin/deposits/list": {"status": "success", "deposits": DEPOSITS,
                             "counts": {"pending": 1, "review": 1, "completed": 1, "failed": 1},
                             "total": len(DEPOSITS), "processedByDay": [], "processedAmount": 0,
                             "truncated": False, "regionKey": "ug"},
    "/admin/withdrawals/list": {"status": "success", "withdrawals": WITHDRAWALS,
                                "counts": {"pending": 1, "processed": 1, "rejected": 1},
                                "total": len(WITHDRAWALS), "processedByDay": [],
                                "processedAmount": 0, "payoutMode": "manual",
                                "truncated": False, "regionKey": "ug"},
    "/admin/transactions/list": {"status": "success", "transactions": TRANSACTIONS,
                                 "truncated": False, "regionKey": "ug"},
    "/admin/referrals/list": {"status": "success", "referrals": REFERRALS,
                              "truncated": False, "regionKey": "ug"},
    "/admin/promocodes/list": {"status": "success", "regionKey": "ug", "codes": [
        {"code": "GIFT1234", "reward": 5000, "maxUses": 10, "uses": 2, "active": True,
         "regionKey": "ug", "expiresAt": None, "createdAt": "2026-09-01T10:00:00Z"}]},
    "/admin/messages/list": {"status": "success", "regionKey": "ug", "messages": [
        {"id": "m1", "title": "Welcome", "body": "Welcome to the app.", "active": True,
         "regionKey": "ug", "createdAt": "2026-09-01T08:00:00Z"}]},
    "/admin/admins/list": {"status": "success", "admins": [
        {"username": "owner", "role": "owner", "active": True,
         "createdAt": "2026-08-01T10:00:00Z", "lastLoginAt": "2026-09-14T08:00:00Z"},
        {"username": "jane", "role": "staff", "active": False,
         "createdAt": "2026-08-05T10:00:00Z", "lastLoginAt": None}]},
    "/admin/audit-log": {"status": "success", "log": [
        {"id": "a1", "action": "settings_update", "actor": "owner", "ip": "1.2.3.4",
         "at": "2026-09-14T08:00:00Z", "detail": {"minDeposit": 30000}}]},
    "/admin/banner": {"status": "success", "image": None, "video": None, "videoVersion": None},
    "/admin/help-banner": {"status": "success", "image": None},
    "/admin/announcement-image": {"status": "success", "image": None},
    "/admin/about-content": {"status": "success", "blocks": [
        {"title": "About us", "body": "We pay daily."}]},
    "/admin/push/list": {"status": "success", "count": 0},
    "/admin/manual-numbers/list": {"status": "success", "numbers": [
        {"id": "n1", "number": "0770000001", "holderName": "John Doe", "network": "mtn",
         "active": True, "regionKey": "ug"}]},
    "/admin/manual-numbers/analytics": {"status": "success", "rows": []},
    "/admin/manual-reversals/list": {"status": "success", "rows": []},
    "/admin/manual-pay-images": {"status": "success", "selector": None, "hero": None},
    "/admin/chipz-images": {"status": "success", "referral": None, "logo": None, "spin": None,
                            "profilegif": None, "downloadbg": None, "authhero": None,
                            "authcard": None},
    "/admin/brand-assets": {"status": "success", "appIcon": None, "appIconCustom": False,
                            "linkPreview": None, "linkPreviewCustom": False,
                            "sizes": {"appIcon": "512 × 512", "linkPreview": "1200 × 630"}},
    "/admin/marzpay/balance": {"status": "success", "amount": 0, "formatted": "UGX 0",
                               "currency": "UGX", "accountStatus": "active"},
    # The PesaJet card is hidden unless the gateway is selected or has history,
    # so a fixture that left either out would render nothing and the sweep would
    # report the whole card as clean having never seen it -- the same shape of
    # false green the Deposits/Withdrawals tabs produced. truncated and an unset
    # key are both switched on here so their notes render too; the two branches
    # one fixture cannot also reach (an empty summary, a failed read) are covered
    # by the static inventory audit in test-pesajet.js instead.
    "/admin/pesajet/summary": {
        "status": "success", "regionKey": "ug", "truncated": True,
        "configured": False, "selected": True,
        "note": "Chipz's own record of money moved through PesaJet.",
        "regions": [{"regionKey": "ug", "currency": "UGX",
                     "collected": 450000, "collectedCount": 9,
                     "paidOut": 180000, "paidOutCount": 3, "net": 270000,
                     "pendingIn": 60000, "pendingInCount": 2,
                     "pendingOut": 25000, "pendingOutCount": 1}]},
    "/admin/user/detail": {"status": "success", "user": USERS[0], "transactions": TRANSACTIONS,
                           "investments": [], "deposits": DEPOSITS[:1],
                           "withdrawals": WITHDRAWALS[:1]},
}


