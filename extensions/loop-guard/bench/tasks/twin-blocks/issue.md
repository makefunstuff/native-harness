Production deploys time out. In `deploy/envs.py`, the `production` environment must use a
`timeout` of 120 and `retries` of 5. `staging` and `dev` keep their current values. Also add
a `"region": "eu-north-1"` entry to production only.

Run the tests with: python3 -m unittest discover -s tests
