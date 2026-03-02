#!/usr/bin/env bash
set -euo pipefail

if ! xcrun simctl list devices booted | grep -q "Booted"; then
  echo "No booted iOS simulator found. Start one first (or run 'pnpm --filter @alchemy/mobile ios')."
  exit 1
fi

default_predicate='process == "Expo Go" OR process == "Exponent" OR process CONTAINS[c] "alchemy" OR subsystem CONTAINS[c] "com.facebook.react" OR category CONTAINS[c] "ReactNative" OR eventMessage CONTAINS[c] "RCT" OR eventMessage CONTAINS[c] "Unhandled"'
predicate="${IOS_LOG_PREDICATE:-$default_predicate}"

echo "Streaming iOS simulator logs from booted device..."
echo "Predicate: $predicate"
exec xcrun simctl spawn booted log stream --style compact --predicate "$predicate"
