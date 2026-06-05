import { csvResponse } from '@/lib/admin/csv';

export async function GET() {
  return csvResponse(
    'yokoagent-account-template.csv',
    ['产品', '渠道', '渠道状态', '代理商名称', '体裁', '登录账号', '密码', '账号状态', '飞书webhook'],
    [['示例产品A', '广点通', '启用', '示例代理A', '短剧、小游戏', 'gdt-example-a', 'Gd7pQ4mR2x', '启用', 'https://open.feishu.cn/open-apis/bot/v2/hook/example']]
  );
}
