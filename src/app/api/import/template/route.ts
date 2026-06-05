import { csvResponse } from '@/lib/admin/csv';

export async function GET() {
  return csvResponse(
    'yokoagent-t1-records-template.csv',
    ['日期', '产品', '渠道', '代理商名称', '体裁', '消耗', '激活数', 'CTR', 'CVR', 'CPM', '次留', '7留', '填写人'],
    [['2026-06-04', '示例产品A', '广点通', '示例代理A', '短剧', '6800', '100', '1.25%', '6.8%', '42.5', '35%', '13%', '示例填写人']]
  );
}
