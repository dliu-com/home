import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { LaundrySiteStack } from '../lib/laundry-site-stack';

test('creates the static site and timestamp API', () => {
  const app = new App();
  const stack = new LaundrySiteStack(app, 'LaundryTestStack', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    KeySchema: [
      { AttributeName: 'recordType', KeyType: 'HASH' },
      { AttributeName: 'recordId', KeyType: 'RANGE' },
    ],
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Code: {
      ZipFile: Match.stringLikeRegexp('kaka-teeth[\\s\\S]*Limit: 10'),
    },
    Runtime: 'nodejs22.x',
  });
  template.resourceCountIs('AWS::Lambda::Url', 1);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 0);
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: Match.anyValue(),
      DefaultRootObject: 'index.html',
      Enabled: true,
      HttpVersion: 'http2and3',
    }),
  });
  template.hasResourceProperties('Custom::CDKBucketDeployment', {
    Exclude: ['*.html'],
    SystemMetadata: {
      'cache-control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
    },
  });
  template.hasResourceProperties('Custom::CDKBucketDeployment', {
    Exclude: ['*'],
    Include: ['*.html'],
    SystemMetadata: Match.absent(),
  });
  template.hasResourceProperties('AWS::Route53::RecordSet', {
    Type: 'A',
  });
});
