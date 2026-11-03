# [Home Tasks](https://home.dliu.com)

A small website for recording recurring home tasks. The home page links to separate trackers for laundry, guinea pig cleaning, hanging clothes, and Kaka teeth brushing. Laundry uses a rolling 40-hour target, guinea pig cleaning uses 70 hours, hanging clothes uses 45 hours, and Kaka teeth brushing uses 100 hours.

The current user-facing rules are documented at [`/rules.html`](https://home.dliu.com/rules.html). How the site works (technical architecture, task rules, cost and security) is documented at [`/docs`](https://home.dliu.com/docs).

## Architecture

The project follows the `home-site` layout:

- `src/` contains the static webpages. Each page has the same static `dl-nav` menu in its shared `dl-header` (see [Shared UI](#shared-ui)).
- CloudFront serves the site from a private S3 bucket at `home.dliu.com`.
- A viewer-request CloudFront Function (`PageRoutes`) serves the extensionless `/docs` (and `/docs/`) from `docs.html`; every other path is served as-is.
- `POST /api/timestamps` records the server's current time for the selected task through a Lambda Function URL.
- `GET /api/timestamps` returns the selected task's latest 10 timestamps from DynamoDB.
- `DELETE /api/timestamps` deletes a selected task record during its first hour, after browser confirmation.
- DynamoDB atomically rejects attempts made within one hour of the previous record for the same task.
- The DynamoDB table is retained if the CloudFormation stack is deleted.

## Shared UI

Every page uses the shared dliu.com look ([spec](https://files.dliu.com/dliu.com/README.md), [demo](https://files.dliu.com/dliu.com/ui/v1/demo.html)):

- `https://files.dliu.com/dliu.com/ui/v1/dl.css` loads first, then `/styles.css`. The site has no logo of its own, so the DL icon `https://files.dliu.com/dliu.com/favicon.png` is its favicon and header logo.
- Pages use the shared `dl-header` (logo and `Home Tasks` in one `dl-brand` link, then `dl-nav`), `dl-main`, `dl-footer` (starting with the shared DL logo, `dl-footer-logo`), `dl-card`, `dl-button` and `dl-error`/`dl-success` classes. Light theme only, no shared JavaScript.
- The `dl-nav` ends with the `Docs` button (`dl-button`) after the text links, and every footer reads `dliu.com · Docs · Rules`.
- `src/docs.html` also loads `https://files.dliu.com/dliu.com/ui/v1/dl-docs.css` (after `dl.css`) and uses `dl-docs-main`, the shared `dl-tabs` (anchors to its sections) and `<article class="dl-docs">`.
- `src/styles.css` keeps only app-specific rules and uses the `--dl-*` variables, with no colours of its own.
- When adding a page, copy the header and footer from an existing page and add it to the nav on every page. `cdk/test/shared-ui.test.ts` guards this.

## Caching

- **Edge (CloudFront):** HTTP/2 and HTTP/3 are enabled. `app.js` and `styles.css` are uploaded with `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=86400`, so browsers keep them for 5 minutes and CloudFront for up to 1 day. HTML pages have no `Cache-Control` header and use CloudFront's default caching (up to 1 day at the edge).
- **API:** `/api/*` is never cached (`CachingDisabled` policy, and responses send `cache-control: no-store`).
- **Clearing:** every deploy invalidates `/*` once, so changes show immediately.
- **Automatic clearing (S3 events → CloudFront invalidation): not used.** The site bucket only changes through deploys, which already clear the whole cache. Task records live in DynamoDB, not S3. Adding automatic clearing would only spend the 1,000 free invalidation paths a month that all dliu.com sites share. Don't edit the bucket by hand; if you do, run a CloudFront invalidation yourself.

## Cost model

The stack avoids provisioned servers, NAT gateways, load balancers, API Gateway, and other resources with meaningful fixed monthly fees. Lambda, DynamoDB on-demand, S3, and CloudFront are charged according to requests, storage, execution time, and data transfer. The ACM certificate is free, and the Route 53 hosted zone is imported from the existing dliu.com infrastructure rather than created by this stack.

## Commands

```sh
make install
make test
make synth
make deploy
```

## Deployment

Deploy from a machine with AWS credentials for the account by running `make deploy`. It runs `cdk deploy` for the `LaundrySite` stack in `eu-west-1`. There is no CI deployment pipeline.
