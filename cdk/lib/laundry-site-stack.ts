import * as path from 'path';
import { Construct } from 'constructs';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';

export class LaundrySiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const rootDomain = Fn.importValue('MainDomain');
    const domainName = `home.${rootDomain}`;
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
      zoneName: rootDomain,
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });

    const recordsTable = new dynamodb.Table(this, 'LaundryRecords', {
      partitionKey: { name: 'recordType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'recordId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const recordsHandler = new lambda.Function(this, 'LaundryRecordsHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: recordsTable.tableName },
      code: lambda.Code.fromInline(`
const { DeleteItemCommand, DynamoDBClient, QueryCommand, TransactWriteItemsCommand } = require('@aws-sdk/client-dynamodb');
const client = new DynamoDBClient({});
const oneHourInMilliseconds = 60 * 60 * 1000;
const tasks = {
  'laundry': { label: 'Laundry' },
  'guinea-pigs': { label: 'Guinea pig cleaning' },
  'hang-clothes': { label: 'Hanging clothes' },
  'kaka-teeth': { label: 'Kaka teeth brushing' },
};

exports.handler = async (event, context) => {
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  };

  try {
    const method = event.requestContext?.http?.method || event.httpMethod;
    let requestBody = {};
    if (method === 'POST' || method === 'DELETE') {
      try {
        requestBody = JSON.parse(event.body || '{}');
      } catch {
        return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request body.' }) };
      }
    }

    const task = requestBody.task || event.queryStringParameters?.task || 'laundry';
    const taskConfig = tasks[task];
    if (!taskConfig) {
      return { statusCode: 400, headers, body: JSON.stringify({ message: 'Unknown task.' }) };
    }

    if (method === 'POST') {
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const cooldownCutoff = new Date(now - oneHourInMilliseconds).toISOString();

      const latestResult = await client.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'recordType = :recordType',
        ExpressionAttributeValues: { ':recordType': { S: task } },
        ProjectionExpression: '#timestamp',
        ExpressionAttributeNames: { '#timestamp': 'timestamp' },
        ScanIndexForward: false,
        ConsistentRead: true,
        Limit: 1,
      }));
      const latestTimestamp = latestResult.Items?.[0]?.timestamp?.S;
      if (latestTimestamp && latestTimestamp > cooldownCutoff) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            message: taskConfig.label + ' was already recorded within the last hour. Please wait before recording again.',
          }),
        };
      }

      try {
        await client.send(new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: process.env.TABLE_NAME,
                Item: {
                  recordType: { S: task + '-control' },
                  recordId: { S: 'latest' },
                  timestamp: { S: timestamp },
                },
                ConditionExpression: 'attribute_not_exists(#timestamp) OR #timestamp <= :cooldownCutoff',
                ExpressionAttributeNames: { '#timestamp': 'timestamp' },
                ExpressionAttributeValues: { ':cooldownCutoff': { S: cooldownCutoff } },
              },
            },
            {
              Put: {
                TableName: process.env.TABLE_NAME,
                Item: {
                  recordType: { S: task },
                  recordId: { S: timestamp + '#' + context.awsRequestId },
                  timestamp: { S: timestamp },
                },
              },
            },
          ],
        }));
      } catch (error) {
        if (error.name === 'TransactionCanceledException') {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
              message: taskConfig.label + ' was already recorded within the last hour. Please wait before recording again.',
            }),
          };
        }
        throw error;
      }

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          message: taskConfig.label + ' recorded successfully.',
          timestamp,
        }),
      };
    }

    if (method === 'GET') {
      const result = await client.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'recordType = :recordType',
        ExpressionAttributeValues: { ':recordType': { S: task } },
        ProjectionExpression: 'recordId, #timestamp',
        ExpressionAttributeNames: { '#timestamp': 'timestamp' },
        ScanIndexForward: false,
        Limit: 10,
      }));
      const records = (result.Items || []).map((item) => ({
        id: item.recordId.S,
        timestamp: item.timestamp.S,
      }));
      const timestamps = records.map((record) => record.timestamp);
      return { statusCode: 200, headers, body: JSON.stringify({ records, timestamps }) };
    }

    if (method === 'DELETE') {
      const recordId = requestBody.id;
      if (typeof recordId !== 'string' || !recordId.includes('#')) {
        return { statusCode: 400, headers, body: JSON.stringify({ message: 'A valid record ID is required.' }) };
      }

      const deleteCutoff = new Date(Date.now() - oneHourInMilliseconds).toISOString();
      let deleted;
      try {
        deleted = await client.send(new DeleteItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            recordType: { S: task },
            recordId: { S: recordId },
          },
          ConditionExpression: '#timestamp > :deleteCutoff',
          ExpressionAttributeNames: { '#timestamp': 'timestamp' },
          ExpressionAttributeValues: { ':deleteCutoff': { S: deleteCutoff } },
          ReturnValues: 'ALL_OLD',
        }));
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({
              message: taskConfig.label + ' records can only be deleted within one hour of being recorded.',
            }),
          };
        }
        throw error;
      }

      if (!deleted.Attributes) {
        return { statusCode: 404, headers, body: JSON.stringify({ message: taskConfig.label + ' record not found.' }) };
      }

      const deletedTimestamp = deleted.Attributes.timestamp.S;
      try {
        await client.send(new DeleteItemCommand({
          TableName: process.env.TABLE_NAME,
          Key: {
            recordType: { S: task + '-control' },
            recordId: { S: 'latest' },
          },
          ConditionExpression: '#timestamp = :deletedTimestamp',
          ExpressionAttributeNames: { '#timestamp': 'timestamp' },
          ExpressionAttributeValues: { ':deletedTimestamp': { S: deletedTimestamp } },
        }));
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: taskConfig.label + ' record deleted successfully.' }),
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers, body: JSON.stringify({ message: 'Internal server error' }) };
  }
};
`),
    });
    recordsTable.grantReadWriteData(recordsHandler);
    const recordsFunctionUrl = recordsHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName,
      hostedZone,
      region: 'us-east-1',
    });
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'SiteOriginAccessIdentity');
    const apiOrigin = new origins.HttpOrigin(
      Fn.select(2, Fn.split('/', recordsFunctionUrl.url)),
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    // Central traffic monitoring (dliu-com/traffic-monitor): shared visitor cookie; TrafficMonitor
    // creates this distribution's access-log delivery (CloudFront standard logging v2).
    const visitorIdFunction = cloudfront.Function.fromFunctionAttributes(this, 'VisitorId', {
      functionArn: Fn.importValue('TrafficVisitorFunctionArn'),
      functionName: 'dliu-visitor-id',
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(siteBucket, { originAccessIdentity }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE, function: visitorIdFunction }],
      },
      additionalBehaviors: {
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(5) },
      ],
    });
    // IncludeCookies is the only legacy logging setting v2 honours: it puts the dl_vid cookie in the logs.
    (distribution.node.defaultChild as cloudfront.CfnDistribution)
      .addPropertyOverride('DistributionConfig.Logging', { IncludeCookies: true });

    siteBucket.grantRead(originAccessIdentity);
    new s3deploy.BucketDeployment(this, 'DeploySiteFiles', {
      destinationBucket: siteBucket,
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'src'))],
      distribution,
      distributionPaths: ['/*'],
    });

    new route53.ARecord(this, 'SiteAliasRecord', {
      zone: hostedZone,
      recordName: 'home',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });
    new route53.AaaaRecord(this, 'SiteAliasIpv6Record', {
      zone: hostedZone,
      recordName: 'home',
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, 'WebsiteUrl', { value: `https://${domainName}` });
  }
}
