Production deploys time out. In `deploy/envs.ts`, the `production` environment must use a
`timeout` of 120 and `retries` of 5. `staging` and `dev` keep their current values. Also add
`region: "eu-north-1"` to production only.

Run the tests with: node --test tests/*.spec.ts
