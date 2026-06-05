import { csvResponse } from '@/lib/admin/csv';

export async function GET() {
  return csvResponse(
    'yokoagent-target-template.csv',
    ['产品', '渠道', '代理商名称', '体裁', '是否在投', '考核生效日期', '考核CPA', '考核次留', '考核7留', '激活量级上限', '备注'],
    [['示例产品A', '广点通', '演示-广点通A', '短剧', '是', '2026-05-01', '68', '34%', '12%', '5000', '示例行，导入前可删除']]
  );
}
