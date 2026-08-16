import { pathToFileURL } from 'node:url';

const ref = (name) => ({ Ref: name });
const sub = (value) => ({ 'Fn::Sub': value });
const get = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });
const az = (index) => ({ 'Fn::Select': [index, { 'Fn::GetAZs': '' }] });

function named(name) {
  return [{ Key: 'Name', Value: sub(`\${AWS::StackName}-${name}`) }];
}

export function buildPilotStack() {
  const Resources = {};

  Resources.Vpc = {
    Type: 'AWS::EC2::VPC',
    Properties: {
      CidrBlock: '10.42.0.0/16',
      EnableDnsHostnames: true,
      EnableDnsSupport: true,
      Tags: named('vpc'),
    },
  };
  Resources.InternetGateway = { Type: 'AWS::EC2::InternetGateway' };
  Resources.VpcGatewayAttachment = {
    Type: 'AWS::EC2::VPCGatewayAttachment',
    Properties: { InternetGatewayId: ref('InternetGateway'), VpcId: ref('Vpc') },
  };

  for (const [name, cidr, zone, publicIp] of [
    ['PublicSubnetA', '10.42.0.0/24', 0, true],
    ['PublicSubnetB', '10.42.1.0/24', 1, true],
    ['AppSubnetA', '10.42.10.0/24', 0, false],
    ['AppSubnetB', '10.42.11.0/24', 1, false],
    ['DatabaseSubnetA', '10.42.20.0/24', 0, false],
    ['DatabaseSubnetB', '10.42.21.0/24', 1, false],
  ]) {
    Resources[name] = {
      Type: 'AWS::EC2::Subnet',
      Properties: {
        AvailabilityZone: az(zone),
        CidrBlock: cidr,
        MapPublicIpOnLaunch: publicIp,
        VpcId: ref('Vpc'),
        Tags: named(name.toLowerCase()),
      },
    };
  }

  Resources.PublicRouteTable = {
    Type: 'AWS::EC2::RouteTable',
    Properties: { VpcId: ref('Vpc'), Tags: named('public') },
  };
  Resources.PublicDefaultRoute = {
    Type: 'AWS::EC2::Route',
    DependsOn: 'VpcGatewayAttachment',
    Properties: {
      DestinationCidrBlock: '0.0.0.0/0',
      GatewayId: ref('InternetGateway'),
      RouteTableId: ref('PublicRouteTable'),
    },
  };
  for (const subnet of ['PublicSubnetA', 'PublicSubnetB']) {
    Resources[`${subnet}RouteTableAssociation`] = {
      Type: 'AWS::EC2::SubnetRouteTableAssociation',
      Properties: { RouteTableId: ref('PublicRouteTable'), SubnetId: ref(subnet) },
    };
  }

  Resources.NatEip = {
    Type: 'AWS::EC2::EIP',
    DependsOn: 'VpcGatewayAttachment',
    Properties: { Domain: 'vpc' },
  };
  Resources.NatGateway = {
    Type: 'AWS::EC2::NatGateway',
    Properties: {
      AllocationId: get('NatEip', 'AllocationId'),
      SubnetId: ref('PublicSubnetA'),
      Tags: named('nat-a'),
    },
  };
  Resources.AppRouteTable = {
    Type: 'AWS::EC2::RouteTable',
    Properties: { VpcId: ref('Vpc'), Tags: named('app') },
  };
  Resources.AppDefaultRoute = {
    Type: 'AWS::EC2::Route',
    Properties: {
      DestinationCidrBlock: '0.0.0.0/0',
      NatGatewayId: ref('NatGateway'),
      RouteTableId: ref('AppRouteTable'),
    },
  };
  for (const subnet of ['AppSubnetA', 'AppSubnetB']) {
    Resources[`${subnet}RouteTableAssociation`] = {
      Type: 'AWS::EC2::SubnetRouteTableAssociation',
      Properties: { RouteTableId: ref('AppRouteTable'), SubnetId: ref(subnet) },
    };
  }

  Resources.DatabaseRouteTable = {
    Type: 'AWS::EC2::RouteTable',
    Properties: { VpcId: ref('Vpc'), Tags: named('database') },
  };
  for (const subnet of ['DatabaseSubnetA', 'DatabaseSubnetB']) {
    Resources[`${subnet}RouteTableAssociation`] = {
      Type: 'AWS::EC2::SubnetRouteTableAssociation',
      Properties: { RouteTableId: ref('DatabaseRouteTable'), SubnetId: ref(subnet) },
    };
  }

  const openEgress = [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }];
  Resources.ApiSecurityGroup = {
    Type: 'AWS::EC2::SecurityGroup',
    Properties: {
      GroupDescription: 'Cloud API tasks; inbound only from the pilot ALB.',
      VpcId: ref('Vpc'),
      SecurityGroupEgress: openEgress,
      Tags: named('api'),
    },
  };
  Resources.WebSecurityGroup = {
    Type: 'AWS::EC2::SecurityGroup',
    Properties: {
      GroupDescription: 'Control Web tasks; inbound only from the pilot ALB.',
      VpcId: ref('Vpc'),
      SecurityGroupEgress: openEgress,
      Tags: named('web'),
    },
  };
  Resources.AlbSecurityGroup = {
    Type: 'AWS::EC2::SecurityGroup',
    Properties: {
      GroupDescription: 'Internet-facing HTTPS entrypoint for pilot Cloud API and Event Control.',
      VpcId: ref('Vpc'),
      SecurityGroupIngress: [
        { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, CidrIp: '0.0.0.0/0' },
        { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0' },
      ],
      SecurityGroupEgress: [
        {
          IpProtocol: 'tcp',
          FromPort: 3001,
          ToPort: 3001,
          DestinationSecurityGroupId: ref('ApiSecurityGroup'),
        },
        {
          IpProtocol: 'tcp',
          FromPort: 3000,
          ToPort: 3000,
          DestinationSecurityGroupId: ref('WebSecurityGroup'),
        },
      ],
      Tags: named('alb'),
    },
  };
  for (const [name, group, port] of [
    ['AlbToApiIngress', 'ApiSecurityGroup', 3001],
    ['AlbToWebIngress', 'WebSecurityGroup', 3000],
  ]) {
    Resources[name] = {
      Type: 'AWS::EC2::SecurityGroupIngress',
      Properties: {
        GroupId: ref(group),
        IpProtocol: 'tcp',
        FromPort: port,
        ToPort: port,
        SourceSecurityGroupId: ref('AlbSecurityGroup'),
      },
    };
  }
  Resources.DatabaseSecurityGroup = {
    Type: 'AWS::EC2::SecurityGroup',
    Properties: {
      GroupDescription: 'Pilot PostgreSQL; reachable only from Cloud API tasks.',
      VpcId: ref('Vpc'),
      SecurityGroupEgress: [],
      Tags: named('database'),
    },
  };
  Resources.ApiToDatabaseIngress = {
    Type: 'AWS::EC2::SecurityGroupIngress',
    Properties: {
      GroupId: ref('DatabaseSecurityGroup'),
      IpProtocol: 'tcp',
      FromPort: 5432,
      ToPort: 5432,
      SourceSecurityGroupId: ref('ApiSecurityGroup'),
    },
  };

  Resources.DatabaseSecret = {
    Type: 'AWS::SecretsManager::Secret',
    Properties: {
      Description: 'Generated PostgreSQL credentials for Event Commerce OS controlled pilot.',
      GenerateSecretString: {
        SecretStringTemplate: '{"username":"event_commerce"}',
        GenerateStringKey: 'password',
        PasswordLength: 32,
        ExcludePunctuation: true,
      },
    },
  };
  Resources.MpesaSecret = {
    Type: 'AWS::SecretsManager::Secret',
    Properties: {
      Description: 'M-PESA sandbox credentials. Empty until payment rehearsal.',
      SecretString: '{"consumerKey":"","consumerSecret":"","businessShortCode":"","passkey":""}',
    },
  };
  Resources.DatabaseSubnetGroup = {
    Type: 'AWS::RDS::DBSubnetGroup',
    Properties: {
      DBSubnetGroupDescription: 'Isolated pilot database subnets.',
      SubnetIds: [ref('DatabaseSubnetA'), ref('DatabaseSubnetB')],
    },
  };
  Resources.Database = {
    Type: 'AWS::RDS::DBInstance',
    DeletionPolicy: 'Snapshot',
    UpdateReplacePolicy: 'Snapshot',
    Properties: {
      AllocatedStorage: '20',
      MaxAllocatedStorage: 100,
      StorageType: 'gp3',
      StorageEncrypted: true,
      Engine: 'postgres',
      EngineVersion: {
        'Fn::If': ['HasDatabaseEngineVersion', ref('DatabaseEngineVersion'), ref('AWS::NoValue')],
      },
      DBInstanceClass: ref('DatabaseInstanceClass'),
      DBName: 'event_commerce_cloud',
      MasterUsername: 'event_commerce',
      MasterUserPassword: sub('{{resolve:secretsmanager:${DatabaseSecret}:SecretString:password}}'),
      DBSubnetGroupName: ref('DatabaseSubnetGroup'),
      VPCSecurityGroups: [ref('DatabaseSecurityGroup')],
      PubliclyAccessible: false,
      MultiAZ: false,
      BackupRetentionPeriod: 7,
      CopyTagsToSnapshot: true,
      AutoMinorVersionUpgrade: false,
      DeletionProtection: false,
    },
  };

  for (const [name, component] of [
    ['CloudApiRepository', 'cloud-api'],
    ['ControlWebRepository', 'control-web'],
  ]) {
    Resources[name] = {
      Type: 'AWS::ECR::Repository',
      Properties: {
        ImageScanningConfiguration: { ScanOnPush: true },
        ImageTagMutability: 'IMMUTABLE',
        EncryptionConfiguration: { EncryptionType: 'AES256' },
        LifecyclePolicy: {
          LifecyclePolicyText: JSON.stringify({
            rules: [
              {
                rulePriority: 1,
                description: 'Keep the most recent 20 pilot release images.',
                selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 20 },
                action: { type: 'expire' },
              },
            ],
          }),
        },
        Tags: [{ Key: 'Component', Value: component }],
      },
    };
  }

  Resources.Cluster = {
    Type: 'AWS::ECS::Cluster',
    Properties: {
      ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
      Tags: [{ Key: 'Environment', Value: 'controlled-pilot' }],
    },
  };
  Resources.ApiLogGroup = {
    Type: 'AWS::Logs::LogGroup',
    Properties: { LogGroupName: sub('/event-commerce/${AWS::StackName}/cloud-api'), RetentionInDays: 30 },
  };
  Resources.WebLogGroup = {
    Type: 'AWS::Logs::LogGroup',
    Properties: { LogGroupName: sub('/event-commerce/${AWS::StackName}/control-web'), RetentionInDays: 30 },
  };

  Resources.TaskExecutionRole = {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: ['ecs-tasks.amazonaws.com'] }, Action: ['sts:AssumeRole'] }],
      },
      Policies: [
        {
          PolicyName: 'ecs-runtime-material',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              { Effect: 'Allow', Action: ['ecr:GetAuthorizationToken'], Resource: '*' },
              {
                Effect: 'Allow',
                Action: ['ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'],
                Resource: [get('CloudApiRepository', 'Arn'), get('ControlWebRepository', 'Arn')],
              },
              {
                Effect: 'Allow',
                Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: [sub('${ApiLogGroup.Arn}:*'), sub('${WebLogGroup.Arn}:*')],
              },
              {
                Effect: 'Allow',
                Action: ['secretsmanager:GetSecretValue'],
                Resource: [ref('DatabaseSecret'), ref('MpesaSecret')],
              },
            ],
          },
        },
      ],
    },
  };
  Resources.TaskRole = {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: ['ecs-tasks.amazonaws.com'] }, Action: ['sts:AssumeRole'] }],
      },
    },
  };

  const restricted = {
    ReadonlyRootFilesystem: true,
    LinuxParameters: { InitProcessEnabled: true, Capabilities: { Drop: ['ALL'] } },
  };
  Resources.CloudApiTaskDefinition = {
    Type: 'AWS::ECS::TaskDefinition',
    Properties: {
      Family: sub('${AWS::StackName}-cloud-api'),
      Cpu: '512',
      Memory: '1024',
      NetworkMode: 'awsvpc',
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'X86_64', OperatingSystemFamily: 'LINUX' },
      ExecutionRoleArn: get('TaskExecutionRole', 'Arn'),
      TaskRoleArn: get('TaskRole', 'Arn'),
      ContainerDefinitions: [
        {
          Name: 'cloud-api',
          Image: sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/${CloudApiRepository}:${ReleaseCommit}'),
          Essential: true,
          PortMappings: [{ ContainerPort: 3001, Protocol: 'tcp' }],
          EntryPoint: ['/bin/sh', '-c'],
          Command: ['export DATABASE_URL="postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:5432/${DATABASE_NAME}?sslmode=require"; exec node dist/main.js'],
          Environment: [
            { Name: 'NODE_ENV', Value: 'production' },
            { Name: 'PORT', Value: '3001' },
            { Name: 'RELEASE_COMMIT', Value: ref('ReleaseCommit') },
            { Name: 'CONTROL_WEB_ORIGIN', Value: sub('https://${ControlDomainName}') },
            { Name: 'DATABASE_HOST', Value: get('Database', 'Endpoint.Address') },
            { Name: 'DATABASE_USER', Value: 'event_commerce' },
            { Name: 'DATABASE_NAME', Value: 'event_commerce_cloud' },
            { Name: 'DATABASE_CONNECTION_TIMEOUT_MS', Value: '5000' },
            { Name: 'ABUSE_DEPLOYMENT_MODE', Value: 'single_instance_pilot' },
            { Name: 'ABUSE_UPSTREAM_CONFIRMED', Value: 'false' },
            { Name: 'TRUST_PROXY_HOPS', Value: '1' },
            { Name: 'MPESA_BASE_URL', Value: 'https://sandbox.safaricom.co.ke' },
            { Name: 'MPESA_CALLBACK_URL', Value: sub('https://${ApiDomainName}/payments/providers/mpesa/callback') },
            { Name: 'MPESA_TRANSACTION_TYPE', Value: 'CustomerPayBillOnline' },
            { Name: 'MPESA_TIMEOUT_MS', Value: '10000' },
          ],
          Secrets: [
            { Name: 'DATABASE_PASSWORD', ValueFrom: sub('${DatabaseSecret}:password::') },
            { Name: 'MPESA_CONSUMER_KEY', ValueFrom: sub('${MpesaSecret}:consumerKey::') },
            { Name: 'MPESA_CONSUMER_SECRET', ValueFrom: sub('${MpesaSecret}:consumerSecret::') },
            { Name: 'MPESA_BUSINESS_SHORT_CODE', ValueFrom: sub('${MpesaSecret}:businessShortCode::') },
            { Name: 'MPESA_PASSKEY', ValueFrom: sub('${MpesaSecret}:passkey::') },
          ],
          ...restricted,
          LogConfiguration: {
            LogDriver: 'awslogs',
            Options: { 'awslogs-group': ref('ApiLogGroup'), 'awslogs-region': ref('AWS::Region'), 'awslogs-stream-prefix': 'cloud-api' },
          },
        },
      ],
      Tags: [{ Key: 'ReleaseCommit', Value: ref('ReleaseCommit') }],
    },
  };
  Resources.ControlWebTaskDefinition = {
    Type: 'AWS::ECS::TaskDefinition',
    Properties: {
      Family: sub('${AWS::StackName}-control-web'),
      Cpu: '256',
      Memory: '512',
      NetworkMode: 'awsvpc',
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'X86_64', OperatingSystemFamily: 'LINUX' },
      ExecutionRoleArn: get('TaskExecutionRole', 'Arn'),
      TaskRoleArn: get('TaskRole', 'Arn'),
      ContainerDefinitions: [
        {
          Name: 'control-web',
          Image: sub('${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/${ControlWebRepository}:${ReleaseCommit}'),
          Essential: true,
          PortMappings: [{ ContainerPort: 3000, Protocol: 'tcp' }],
          Environment: [
            { Name: 'NODE_ENV', Value: 'production' },
            { Name: 'PORT', Value: '3000' },
            { Name: 'HOSTNAME', Value: '0.0.0.0' },
            { Name: 'RELEASE_COMMIT', Value: ref('ReleaseCommit') },
          ],
          ...restricted,
          LogConfiguration: {
            LogDriver: 'awslogs',
            Options: { 'awslogs-group': ref('WebLogGroup'), 'awslogs-region': ref('AWS::Region'), 'awslogs-stream-prefix': 'control-web' },
          },
        },
      ],
      Tags: [{ Key: 'ReleaseCommit', Value: ref('ReleaseCommit') }],
    },
  };

  Resources.LoadBalancer = {
    Type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    Properties: {
      Scheme: 'internet-facing',
      Type: 'application',
      IpAddressType: 'ipv4',
      Subnets: [ref('PublicSubnetA'), ref('PublicSubnetB')],
      SecurityGroups: [ref('AlbSecurityGroup')],
      LoadBalancerAttributes: [
        { Key: 'deletion_protection.enabled', Value: 'false' },
        { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
        { Key: 'idle_timeout.timeout_seconds', Value: '60' },
      ],
    },
  };
  for (const [name, port, path] of [
    ['ApiTargetGroup', 3001, '/health'],
    ['WebTargetGroup', 3000, '/api/health'],
  ]) {
    Resources[name] = {
      Type: 'AWS::ElasticLoadBalancingV2::TargetGroup',
      Properties: {
        Port: port,
        Protocol: 'HTTP',
        TargetType: 'ip',
        VpcId: ref('Vpc'),
        HealthCheckEnabled: true,
        HealthCheckPath: path,
        HealthCheckProtocol: 'HTTP',
        HealthyThresholdCount: 2,
        UnhealthyThresholdCount: 3,
        HealthCheckIntervalSeconds: 15,
        HealthCheckTimeoutSeconds: 5,
        Matcher: { HttpCode: '200' },
        TargetGroupAttributes: [{ Key: 'deregistration_delay.timeout_seconds', Value: '30' }],
      },
    };
  }
  Resources.HttpListener = {
    Type: 'AWS::ElasticLoadBalancingV2::Listener',
    Properties: {
      LoadBalancerArn: ref('LoadBalancer'),
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: [{ Type: 'redirect', RedirectConfig: { Protocol: 'HTTPS', Port: '443', StatusCode: 'HTTP_301' } }],
    },
  };
  Resources.HttpsListener = {
    Type: 'AWS::ElasticLoadBalancingV2::Listener',
    Properties: {
      LoadBalancerArn: ref('LoadBalancer'),
      Port: 443,
      Protocol: 'HTTPS',
      Certificates: [{ CertificateArn: ref('CertificateArn') }],
      SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      DefaultActions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '404', ContentType: 'text/plain', MessageBody: 'Not found' } }],
    },
  };
  for (const [name, priority, domain, target] of [
    ['ApiListenerRule', 10, 'ApiDomainName', 'ApiTargetGroup'],
    ['WebListenerRule', 20, 'ControlDomainName', 'WebTargetGroup'],
  ]) {
    Resources[name] = {
      Type: 'AWS::ElasticLoadBalancingV2::ListenerRule',
      Properties: {
        ListenerArn: ref('HttpsListener'),
        Priority: priority,
        Conditions: [{ Field: 'host-header', Values: [ref(domain)] }],
        Actions: [{ Type: 'forward', TargetGroupArn: ref(target) }],
      },
    };
  }

  function service(component, task, securityGroup, port, targetGroup, rule) {
    return {
      Type: 'AWS::ECS::Service',
      DependsOn: [rule],
      Properties: {
        Cluster: ref('Cluster'),
        TaskDefinition: ref(task),
        LaunchType: 'FARGATE',
        PlatformVersion: '1.4.0',
        DesiredCount: ref('DesiredCount'),
        EnableECSManagedTags: true,
        PropagateTags: 'SERVICE',
        HealthCheckGracePeriodSeconds: 60,
        DeploymentConfiguration: {
          DeploymentCircuitBreaker: { Enable: true, Rollback: true },
          MaximumPercent: 200,
          MinimumHealthyPercent: 100,
        },
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            AssignPublicIp: 'DISABLED',
            SecurityGroups: [ref(securityGroup)],
            Subnets: [ref('AppSubnetA'), ref('AppSubnetB')],
          },
        },
        LoadBalancers: [{ ContainerName: component, ContainerPort: port, TargetGroupArn: ref(targetGroup) }],
        Tags: [{ Key: 'Component', Value: component }],
      },
    };
  }
  Resources.CloudApiService = service('cloud-api', 'CloudApiTaskDefinition', 'ApiSecurityGroup', 3001, 'ApiTargetGroup', 'ApiListenerRule');
  Resources.ControlWebService = service('control-web', 'ControlWebTaskDefinition', 'WebSecurityGroup', 3000, 'WebTargetGroup', 'WebListenerRule');

  Resources.ApiUnhealthyAlarm = {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      AlarmDescription: 'Cloud API has an unhealthy target in the pilot ALB.',
      Namespace: 'AWS/ApplicationELB',
      MetricName: 'UnHealthyHostCount',
      Statistic: 'Maximum',
      Period: 60,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      TreatMissingData: 'notBreaching',
      Dimensions: [
        { Name: 'TargetGroup', Value: get('ApiTargetGroup', 'TargetGroupFullName') },
        { Name: 'LoadBalancer', Value: get('LoadBalancer', 'LoadBalancerFullName') },
      ],
    },
  };
  Resources.DatabaseStorageAlarm = {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      AlarmDescription: 'Pilot PostgreSQL free storage is below 2 GiB.',
      Namespace: 'AWS/RDS',
      MetricName: 'FreeStorageSpace',
      Statistic: 'Minimum',
      Period: 300,
      EvaluationPeriods: 2,
      DatapointsToAlarm: 2,
      Threshold: 2147483648,
      ComparisonOperator: 'LessThanThreshold',
      TreatMissingData: 'breaching',
      Dimensions: [{ Name: 'DBInstanceIdentifier', Value: ref('Database') }],
    },
  };

  for (const resource of Object.values(Resources)) {
    resource.Condition ??= 'IsCapeTown';
  }

  const Outputs = {
    LoadBalancerDnsName: { Value: get('LoadBalancer', 'DNSName') },
    ApiUrl: { Value: sub('https://${ApiDomainName}') },
    ControlUrl: { Value: sub('https://${ControlDomainName}') },
    CloudApiRepositoryUri: { Value: get('CloudApiRepository', 'RepositoryUri') },
    ControlWebRepositoryUri: { Value: get('ControlWebRepository', 'RepositoryUri') },
    ClusterName: { Value: ref('Cluster') },
    CloudApiServiceName: { Value: get('CloudApiService', 'Name') },
    ControlWebServiceName: { Value: get('ControlWebService', 'Name') },
    CloudApiTaskDefinitionArn: { Value: ref('CloudApiTaskDefinition') },
    AppSubnetA: { Value: ref('AppSubnetA') },
    AppSubnetB: { Value: ref('AppSubnetB') },
    ApiSecurityGroupId: { Value: ref('ApiSecurityGroup') },
    DatabaseEndpoint: { Value: get('Database', 'Endpoint.Address') },
    DatabaseSecretArn: { Value: ref('DatabaseSecret') },
    MpesaSecretArn: { Value: ref('MpesaSecret') },
  };
  for (const output of Object.values(Outputs)) {
    output.Condition = 'IsCapeTown';
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Event Commerce OS controlled-pilot cloud runtime in AWS Africa (Cape Town).',
    Metadata: {
      EventCommerceOS: {
        Scope: 'controlled-pilot',
        ExpectedRegion: 'af-south-1',
        Notes: 'Event Edge remains venue-local. Cloud services default to zero desired tasks until migrations complete.',
      },
    },
    Parameters: {
      ReleaseCommit: { Type: 'String', AllowedPattern: '^[0-9a-f]{40}$', Description: 'Exact lowercase Git commit SHA used as immutable release identity.' },
      ApiDomainName: { Type: 'String', AllowedPattern: '^[A-Za-z0-9.-]+$', Description: 'Cloud API DNS hostname without scheme or path.' },
      ControlDomainName: { Type: 'String', AllowedPattern: '^[A-Za-z0-9.-]+$', Description: 'Event Control DNS hostname without scheme or path.' },
      CertificateArn: { Type: 'String', AllowedPattern: '^arn:aws[a-zA-Z-]*:acm:af-south-1:[0-9]{12}:certificate/.+$', Description: 'ACM certificate in af-south-1 covering both pilot hostnames.' },
      DesiredCount: { Type: 'Number', Default: 0, MinValue: 0, MaxValue: 1, Description: 'Keep 0 through bootstrap/migration; set 1 only after migration succeeds.' },
      DatabaseInstanceClass: { Type: 'String', Default: 'db.t4g.micro', Description: 'Confirm this RDS class is available in af-south-1 before deployment.' },
      DatabaseEngineVersion: { Type: 'String', Default: '', Description: 'Optional exact PostgreSQL version; blank uses the regional default.' },
    },
    Conditions: {
      IsCapeTown: { 'Fn::Equals': [ref('AWS::Region'), 'af-south-1'] },
      HasDatabaseEngineVersion: { 'Fn::Not': [{ 'Fn::Equals': [ref('DatabaseEngineVersion'), ''] }] },
    },
    Resources,
    Outputs,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(buildPilotStack(), null, 2)}\n`);
}
