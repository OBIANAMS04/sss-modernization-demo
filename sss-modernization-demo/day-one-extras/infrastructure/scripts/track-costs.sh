#!/bin/bash

# SSS Modernization Platform - Cost Tracking & Analysis Script
# Tracks AWS spending and provides optimization recommendations

set -e

ENVIRONMENT=${1:-prod}
AWS_REGION=${AWS_REGION:-us-east-1}
APP_NAME="sss-modernization"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== AWS Cost Tracking & Analysis ===${NC}\n"

# Get current month dates
CURRENT_MONTH_START=$(date -u +%Y-%m-01)
CURRENT_MONTH_END=$(date -u +%Y-%m-%d)
LAST_MONTH_START=$(date -u -d 'last month' +%Y-%m-01)
LAST_MONTH_END=$(date -u -d 'last day of last month' +%Y-%m-%d)

echo -e "${YELLOW}Current Month (${CURRENT_MONTH_START} to ${CURRENT_MONTH_END}):${NC}\n"

# Get costs by service (current month)
echo "Fetching current costs..."
aws ce get-cost-and-usage \
  --time-period Start=$CURRENT_MONTH_START,End=$CURRENT_MONTH_END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[0].Groups[*].[Keys[0], Metrics.UnblendedCost.Amount]' \
  --output table > current-costs.txt

cat current-costs.txt

# Calculate total current cost
CURRENT_TOTAL=$(aws ce get-cost-and-usage \
  --time-period Start=$CURRENT_MONTH_START,End=$CURRENT_MONTH_END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --query 'ResultsByTime[0].Total.UnblendedCost.Amount' \
  --output text)

echo -e "\n${GREEN}Current Month Total: \$$CURRENT_TOTAL${NC}\n"

# Get last month costs
echo -e "${YELLOW}Last Month (${LAST_MONTH_START} to ${LAST_MONTH_END}):${NC}\n"

aws ce get-cost-and-usage \
  --time-period Start=$LAST_MONTH_START,End=$LAST_MONTH_END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[0].Groups[*].[Keys[0], Metrics.UnblendedCost.Amount]' \
  --output table > last-month-costs.txt

cat last-month-costs.txt

# Calculate last month total
LAST_MONTH_TOTAL=$(aws ce get-cost-and-usage \
  --time-period Start=$LAST_MONTH_START,End=$LAST_MONTH_END \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --query 'ResultsByTime[0].Total.UnblendedCost.Amount' \
  --output text)

echo -e "\n${GREEN}Last Month Total: \$$LAST_MONTH_TOTAL${NC}\n"

# Calculate month-over-month change
CHANGE=$(echo "$CURRENT_TOTAL - $LAST_MONTH_TOTAL" | bc)
CHANGE_PERCENT=$(echo "scale=1; ($CHANGE / $LAST_MONTH_TOTAL) * 100" | bc)

if (( $(echo "$CHANGE > 0" | bc -l) )); then
  echo -e "${RED}Month-over-Month Change: +\$$CHANGE (+${CHANGE_PERCENT}%)${NC}\n"
else
  echo -e "${GREEN}Month-over-Month Change: -\$$CHANGE (${CHANGE_PERCENT}%)${NC}\n"
fi

# Get daily costs for trend analysis
echo -e "${YELLOW}Daily Cost Trend (Last 30 Days):${NC}\n"

aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '30 days ago' +%Y-%m-%d),End=$CURRENT_MONTH_END \
  --granularity DAILY \
  --metrics UnblendedCost \
  --query 'ResultsByTime[*].[TimePeriod.Start, Total.UnblendedCost.Amount]' \
  --output text | tail -10 > daily-costs.txt

cat daily-costs.txt

# Estimate end-of-month cost
DAYS_ELAPSED=$(date +%d)
DAYS_IN_MONTH=$(date -d "$(date +%Y-%m-01) + 1 month - 1 day" +%d)

DAILY_AVERAGE=$(echo "scale=2; $CURRENT_TOTAL / $DAYS_ELAPSED" | bc)
ESTIMATED_MONTH=$(echo "scale=2; $DAILY_AVERAGE * $DAYS_IN_MONTH" | bc)

echo -e "\n${YELLOW}Projection for End of Month:${NC}"
echo "Days elapsed: $DAYS_ELAPSED / $DAYS_IN_MONTH"
echo "Daily average: \$$DAILY_AVERAGE"
echo -e "Estimated end-of-month cost: ${GREEN}\$$ESTIMATED_MONTH${NC}\n"

# Budget tracking
BUDGET=450  # $450/month budget

echo -e "${YELLOW}Budget Status:${NC}"
echo "Budget limit: \$$BUDGET"
echo "Current spend: \$$CURRENT_TOTAL"

REMAINING=$(echo "$BUDGET - $CURRENT_TOTAL" | bc)
PERCENT_USED=$(echo "scale=1; ($CURRENT_TOTAL / $BUDGET) * 100" | bc)

if (( $(echo "$PERCENT_USED > 90" | bc -l) )); then
  echo -e "${RED}⚠ CRITICAL: ${PERCENT_USED}% of budget used${NC}"
elif (( $(echo "$PERCENT_USED > 75" | bc -l) )); then
  echo -e "${YELLOW}⚠ WARNING: ${PERCENT_USED}% of budget used${NC}"
else
  echo -e "${GREEN}✓ OK: ${PERCENT_USED}% of budget used (Remaining: \$$REMAINING)${NC}"
fi
echo ""

# Cost by service recommendations
echo -e "${YELLOW}Cost Optimization Recommendations:${NC}\n"

# Check for expensive services
ECS_COST=$(grep -A1 "^[[:space:]]*Amazon Elastic Container Service" current-costs.txt | tail -1 | awk '{print $1}' || echo "0")
RDS_COST=$(grep -A1 "^[[:space:]]*Amazon Relational Database Service" current-costs.txt | tail -1 | awk '{print $1}' || echo "0")
CACHE_COST=$(grep -A1 "^[[:space:]]*Amazon ElastiCache" current-costs.txt | tail -1 | awk '{print $1}' || echo "0")

if (( $(echo "$ECS_COST > 150" | bc -l) )); then
  echo "1. ${YELLOW}ECS Cost (\\$$ECS_COST)${NC}"
  echo "   - Consider: Downsize from 512 CPU to 256 CPU if < 30% CPU usage"
  echo "   - Savings: \$70-80/month"
  echo ""
fi

if (( $(echo "$RDS_COST > 80" | bc -l) )); then
  echo "2. ${YELLOW}RDS Cost (\\$$RDS_COST)${NC}"
  echo "   - Consider: Downgrade db.t3.small to db.t3.micro if < 30% CPU"
  echo "   - Savings: \$30-40/month"
  echo "   - Check CPU utilization first!"
  echo ""
fi

if (( $(echo "$CACHE_COST > 40" | bc -l) )); then
  echo "3. ${YELLOW}Cache Cost (\\$$CACHE_COST)${NC}"
  echo "   - Consider: Downsize cache.t3.small to cache.t3.micro if < 50% memory"
  echo "   - Savings: \$15-20/month"
  echo ""
fi

# General recommendations
echo -e "${YELLOW}General Recommendations:${NC}"
echo "1. ${GREEN}Buy 1-year Reserved Instances${NC} - 40-60% savings"
echo "   - Estimated savings: \$100-150/month"
echo ""
echo "2. ${GREEN}Monitor Resource Utilization${NC}"
echo "   - Check dashboards for CPU/memory trends"
echo "   - Downsize if consistently < 30% utilization"
echo ""
echo "3. ${GREEN}Enable Compression${NC} - Data transfer cost"
echo "   - ALB response compression: -\$5-10/month"
echo ""
echo "4. ${GREEN}Cleanup Unused Resources${NC}"
echo "   - Delete unused snapshots and logs"
echo "   - Archive old audit logs to Glacier: -\$5-15/month"
echo ""

# Save detailed report
cat > cost-analysis-report.txt << EOF
SSS Modernization Platform - Cost Analysis Report
Generated: $(date)

CURRENT MONTH SUMMARY
====================
Start Date: $CURRENT_MONTH_START
End Date: $CURRENT_MONTH_END
Total Cost: \$$CURRENT_TOTAL

LAST MONTH SUMMARY
==================
Start Date: $LAST_MONTH_START
End Date: $LAST_MONTH_END
Total Cost: \$$LAST_MONTH_TOTAL

TREND
=====
Month-over-Month Change: $CHANGE (+${CHANGE_PERCENT}%)
Daily Average: \$$DAILY_AVERAGE
Estimated End-of-Month: \$$ESTIMATED_MONTH

BUDGET
======
Limit: \$$BUDGET
Current: \$$CURRENT_TOTAL
Remaining: \$$REMAINING
Usage: ${PERCENT_USED}%

OPTIMIZATION OPPORTUNITIES
==========================
1. Reserved Instances (1-year): \$100-150/month savings
2. Instance Right-Sizing: \$30-50/month savings
3. Data Transfer Compression: \$5-10/month savings
4. Storage Optimization: \$5-15/month savings
5. Connection Pooling: \$10-20/month savings

TOTAL POTENTIAL SAVINGS: \$150-245/month (35-50% reduction)

RECOMMENDATIONS
===============
Priority 1: Purchase 1-year reserved instances (immediate)
Priority 2: Monitor CPU utilization (1 week)
Priority 3: Right-size instances if CPU < 30% (2 weeks)
Priority 4: Implement database optimizations (4 weeks)
Priority 5: Archive old data and cleanup (ongoing)

See cost-optimization.md for detailed analysis and ROI calculations.
EOF

echo -e "${GREEN}✓ Detailed report saved to: cost-analysis-report.txt${NC}\n"

# Create AWS budgets notification if not already set
echo -e "${YELLOW}Setup Recommendations:${NC}"
echo "1. Create AWS Budget alert:"
echo "   aws budgets create-budget --account-id \$(aws sts get-caller-identity --query Account) \\"
echo "   --budget BudgetName=monthly-limit,BudgetLimit={Amount=450,Unit=USD},TimeUnit=MONTHLY,BudgetType=COST"
echo ""
echo "2. Enable Cost Anomaly Detection:"
echo "   aws ce create-anomaly-detector --frequency DAILY"
echo ""
echo "3. Review costs monthly in AWS Billing Console"
echo ""

echo -e "${GREEN}=== Cost Analysis Complete ===${NC}"
