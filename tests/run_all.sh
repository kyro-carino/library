#!/usr/bin/env bash
# Runs every repeatable check. Run from the project root against a DEVELOPMENT database.
#   BASE=http://localhost/library ADMIN_PW=... [MYSQL_CLI="mysql -u root -P 3306 -h 127.0.0.1"] bash tests/run_all.sh
# tests/stage2_transactions_test.py is NOT included: it assumes a freshly seeded database (see README).
set -u; cd "$(dirname "$0")/.."; rc=0
run(){ echo; echo "=== $*"; "$@" || rc=1; }
run python3 tests/static_check.py
run php tests/stage1_auth_test.php
run python3 tests/smoke_api_test.py
run python3 tests/phase1_session_test.py
run python3 tests/phase2b_input_test.py
run python3 tests/phase2c_audit_test.py
run python3 tests/phase3a_policy_test.py
run python3 tests/phase4_perf_test.py
run python3 tests/phase5a_test.py
run python3 tests/phase6_account_test.py
run python3 tests/phase9_fine_audit_test.py
run python3 tests/phase10_reader_profile_test.py
run python3 tests/web_exposure_check.py
run python3 tests/stage3_api_test.py
if [ -d node_modules/jsdom ]; then run node tests/stage7_ui_smoke.js; else echo; echo "=== SKIP UI smoke (run: npm i --no-save jsdom)"; fi
echo; [ $rc -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"; exit $rc