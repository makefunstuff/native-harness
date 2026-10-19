#!/bin/sh
exec node --test tests/*.spec.ts "$@"
