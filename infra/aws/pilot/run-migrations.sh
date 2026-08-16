#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:=af-south-1}"
: "${STACK_NAME:=event-commerce-pilot}"

if [[ "${AWS_REGION}" != "af-south-1" ]]; then
  echo "Pilot migration task is locked to af-south-1" >&2
  exit 2
fi

output() {
  aws cloudformation describe-stacks \
    --region "${AWS_REGION}" \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

cluster="$(output ClusterName)"
task_definition="$(output CloudApiTaskDefinitionArn)"
subnet_a="$(output AppSubnetA)"
subnet_b="$(output AppSubnetB)"
security_group="$(output ApiSecurityGroupId)"

override='{"containerOverrides":[{"name":"cloud-api","command":["export DATABASE_URL=\"postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:5432/${DATABASE_NAME}?sslmode=require\"; exec node scripts/migrate.mjs"]}]}'

task_arn="$(
  aws ecs run-task \
    --region "${AWS_REGION}" \
    --cluster "${cluster}" \
    --task-definition "${task_definition}" \
    --launch-type FARGATE \
    --platform-version 1.4.0 \
    --network-configuration "awsvpcConfiguration={subnets=[${subnet_a},${subnet_b}],securityGroups=[${security_group}],assignPublicIp=DISABLED}" \
    --overrides "${override}" \
    --query 'tasks[0].taskArn' \
    --output text
)"

if [[ -z "${task_arn}" || "${task_arn}" == "None" ]]; then
  echo "Failed to start migration task" >&2
  exit 3
fi

echo "Migration task: ${task_arn}"
aws ecs wait tasks-stopped --region "${AWS_REGION}" --cluster "${cluster}" --tasks "${task_arn}"

exit_code="$(
  aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${cluster}" \
    --tasks "${task_arn}" \
    --query "tasks[0].containers[?name=='cloud-api'].exitCode | [0]" \
    --output text
)"

if [[ "${exit_code}" != "0" ]]; then
  echo "Cloud migration task failed with exit code ${exit_code}" >&2
  aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${cluster}" \
    --tasks "${task_arn}" \
    --query 'tasks[0].{StoppedReason:stoppedReason,Containers:containers[].{Name:name,Reason:reason,ExitCode:exitCode}}' \
    --output json >&2
  exit 4
fi

echo "Cloud migrations completed successfully"
