# Security policy

This repository must remain free of credentials and private runtime data.

Before every push, run:

```bash
./validate.sh
```

The validator is a guardrail, not a substitute for reviewing `git diff`. If a secret is committed:

1. rotate or revoke it immediately;
2. remove it from the current tree;
3. purge it from Git history before publishing;
4. invalidate any affected sessions or tokens.

Use Pi's `auth.json`, the operating system credential store, environment variables, or a dedicated secret manager for machine-local credentials.
