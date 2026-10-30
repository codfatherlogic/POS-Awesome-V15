# M-Pesa Callback Security Upgrade

## Scope

M-Pesa confirmation and validation callbacks require a secret bound to each successful
`Mpesa C2B Register URL`. Legacy tokenless callbacks fail closed after this upgrade.

## Before Deployment

1. Inventory every successful registration by site, company, mode of payment, business
   shortcode, and till number:

   ```sql
   select name, company, mode_of_payment, business_shortcode, till_number, register_status
   from `tabMpesa C2B Register URL`
   where register_status = 'Success';
   ```

2. Confirm an administrator can update each registration and has the provider credentials
   needed to re-register callback URLs.
3. Plan a short M-Pesa maintenance window. Existing tokenless callback URLs are rejected
   after the application is upgraded and before re-registration completes.

## Upgrade Procedure

1. Deploy the application and run `bench --site <site> migrate`.
2. In each successful `Mpesa C2B Register URL`, set a strong, distinct Callback Secret.
   Do not reuse consumer secrets, store the value in documentation, or transmit it in chat.
3. Save each registration. Saving re-registers validation and confirmation URLs containing
   the encoded `callback_token` query parameter.
4. Confirm the provider accepted the registration and `Register Status` is `Success`.
5. Confirm the provider and every proxy preserve the callback query string.
6. Configure load balancer, reverse-proxy, CDN, APM, and access logs to redact query strings
   for the M-Pesa validation and confirmation paths.

## Readiness Gate

Run as Administrator, System Manager, or Accounts Manager:

```bash
bench --site <site> execute \
  posawesome.posawesome.api.m_pesa.get_mpesa_callback_readiness
```

The result is safe to retain: it reports registration names and readiness booleans, never
secret values. Do not enable M-Pesa unless `ready` is `true`, the missing-secret count is
zero, and every expected successful registration is listed. POS M-Pesa operations are
blocked with a remediation error when a relevant successful legacy registration lacks a
secret.

## Verification

1. Send a provider sandbox validation callback through the registered URL and verify
   `ResultCode: 0`.
2. Send one confirmation and verify exactly one `Mpesa Payment Register` row is created with
   the expected company, payment mode, shortcode, transaction ID, and amount.
3. Replay the same confirmation and verify no second register or Payment Entry is created.
4. Remove or alter the token in a sandbox request and verify `ResultCode: 1` and no row.

## Rollback And Failure Behavior

- Missing, invalid, or tokenless callbacks are rejected and do not persist payload data.
- If re-registration fails, leave M-Pesa disabled, correct provider/proxy configuration, and
  repeat registration. Do not temporarily accept tokenless callbacks.
- Do not roll back only the application code: that would restore the insecure guest callback.
  Disable provider callbacks/M-Pesa first if a full release rollback is unavoidable.
- The migration's unique transaction-ID constraint and preserved legacy duplicate markers
  are safe to retain during rollback.
