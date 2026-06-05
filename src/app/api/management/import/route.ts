import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { missingHeaders, parseBoolean, parseCsv } from '@/lib/admin/csv';
import { decorateAgent, mutateLocalDb, newId, nowIso } from '@/lib/local-db/store';
import { normalizeCreativeTypes } from '@/lib/admin/creativeTypes';

const HEADER_ALIASES: Record<string, string> = {
  产品: 'product_name',
  产品名称: 'product_name',
  渠道: 'channel_name',
  渠道状态: 'channel_status',
  代理商名称: 'agent_name',
  代理商: 'agent_name',
  体裁: 'creative_types',
  投放体裁: 'creative_types',
  creative_type: 'creative_types',
  creative_types: 'creative_types',
  登录账号: 'username',
  密码: 'password',
  初始密码: 'password',
  账号状态: 'agent_status',
  飞书webhook: 'feishu_webhook',
  飞书Webhook: 'feishu_webhook',
  飞书WEBHOOK: 'feishu_webhook',
  飞书标识: 'feishu_webhook',
};

const REQUIRED_HEADERS = ['product_name', 'channel_name', 'channel_status', 'agent_name', 'creative_types', 'username', 'password', 'agent_status'];

async function readCsvText(request: Request) {
  const body = await request.json();
  return String(body.csvText || '');
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const parsed = parseCsv(await readCsvText(request), HEADER_ALIASES);
    if (parsed.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'CSV 没有可导入数据' }, { status: 400 });
    }

    const headerMissing = missingHeaders(parsed.headers, REQUIRED_HEADERS);
    if (headerMissing.length > 0) {
      return NextResponse.json({
        success: false,
        error: `CSV 缺少必填表头: ${headerMissing.join(', ')}`,
      }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const result = await mutateLocalDb(async (db) => {
        const timestamp = nowIso();
        const errors: string[] = [];
        let importedChannels = 0;
        let importedAgents = 0;

        for (const [index, row] of parsed.rows.entries()) {
          const line = index + 2;
          const productName = row.product_name?.trim();
          const channelName = row.channel_name?.trim();
          const agentName = row.agent_name?.trim();
          const username = row.username?.trim();
          const creativeTypes = normalizeCreativeTypes(row.creative_types);
          const channelActive = parseBoolean(row.channel_status, true);
          const agentActive = parseBoolean(row.agent_status, true);
          const password = row.password?.trim();
          const feishuWebhook = row.feishu_webhook?.trim() || '';

          if (!productName || !channelName || !agentName || !username) {
            errors.push(`第 ${line} 行缺少 产品/渠道/代理商名称/登录账号`);
            continue;
          }
          if (creativeTypes.length === 0) {
            errors.push(`第 ${line} 行缺少 体裁`);
            continue;
          }
          if (channelActive == null) {
            errors.push(`第 ${line} 行渠道状态只能填写 启用/停用`);
            continue;
          }
          if (agentActive == null) {
            errors.push(`第 ${line} 行账号状态只能填写 启用/停用`);
            continue;
          }

          let product = db.products.find((item) => item.name === productName);
          if (product) {
            product.is_active = true;
            product.updated_at = timestamp;
          } else {
            product = {
              id: newId(),
              name: productName,
              is_active: true,
              created_at: timestamp,
              updated_at: timestamp,
            };
            db.products.push(product);
          }

          let channel = db.channels.find((item) => item.name === channelName);
          if (channel) {
            channel.is_active = channelActive;
            channel.updated_at = timestamp;
          } else {
            channel = {
              id: newId(),
              name: channelName,
              is_active: channelActive,
              created_at: timestamp,
              updated_at: timestamp,
            };
            db.channels.push(channel);
          }
          importedChannels += 1;

          const byUsername = db.agents.find((agent) => agent.username === username);
          const byScope = db.agents.find((agent) => agent.product_id === product.id && agent.channel_id === channel.id && agent.name === agentName);
          if (byUsername && byScope && byUsername.id !== byScope.id) {
            errors.push(`第 ${line} 行登录账号与渠道代理商指向不同已有账号`);
            continue;
          }

          const existing = byUsername || byScope;
          if (!existing && !password) {
            errors.push(`第 ${line} 行新建代理必须填写密码`);
            continue;
          }

          const passwordHash = password ? await hashPassword(password) : null;
          if (existing) {
            Object.assign(existing, {
              channel_id: channel.id,
              product_id: product.id,
              name: agentName,
              username,
              creative_types: creativeTypes,
              feishu_webhook: feishuWebhook,
              is_active: agentActive,
              updated_at: timestamp,
              ...(passwordHash ? { password_hash: passwordHash, password_plaintext: password } : {}),
            });
          } else {
            db.agents.push({
              id: newId(),
              product_id: product.id,
              channel_id: channel.id,
              name: agentName,
              username,
              creative_types: creativeTypes,
              feishu_webhook: feishuWebhook,
              password_hash: passwordHash!,
              password_plaintext: password!,
              is_active: agentActive,
              created_at: timestamp,
              updated_at: timestamp,
            });
          }
          importedAgents += 1;
        }

        return {
          importedChannels,
          importedAgents,
          errors,
          agents: db.agents.map((agent) => decorateAgent(db, agent)),
        };
      });

      return NextResponse.json({
        success: result.errors.length === 0,
        data: result,
        message: `已导入/更新 ${result.importedAgents} 个代理账号`,
      });
    }

    const supabase = createServerSupabase();
    const errors: string[] = [];
    let importedChannels = 0;
    let importedAgents = 0;

    for (const [index, row] of parsed.rows.entries()) {
        const line = index + 2;
        try {
        const productName = row.product_name?.trim();
        const channelName = row.channel_name?.trim();
        const agentName = row.agent_name?.trim();
        const username = row.username?.trim();
        const creativeTypes = normalizeCreativeTypes(row.creative_types);
        const channelActive = parseBoolean(row.channel_status, true);
        const agentActive = parseBoolean(row.agent_status, true);
        const password = row.password?.trim();
        const feishuWebhook = row.feishu_webhook?.trim() || '';

        if (!productName || !channelName || !agentName || !username) {
          errors.push(`第 ${line} 行缺少 产品/渠道/代理商名称/登录账号`);
          continue;
        }
        if (creativeTypes.length === 0) {
          errors.push(`第 ${line} 行缺少 体裁`);
          continue;
        }
        if (channelActive == null) {
          errors.push(`第 ${line} 行渠道状态只能填写 启用/停用`);
          continue;
        }
        if (agentActive == null) {
          errors.push(`第 ${line} 行账号状态只能填写 启用/停用`);
          continue;
        }

        const { data: existingProduct } = await supabase
          .from('products')
          .select('id')
          .eq('name', productName)
          .maybeSingle();

        let productId = String(existingProduct?.id || '');
        if (productId) {
          const { error } = await supabase
            .from('products')
            .update({ is_active: true })
            .eq('id', productId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from('products')
            .insert({ name: productName, is_active: true })
            .select('id')
            .single();
          if (error) throw error;
          productId = data.id;
        }

        const { data: existingChannel } = await supabase
          .from('channels')
          .select('id')
          .eq('name', channelName)
          .maybeSingle();

        let channelId = String(existingChannel?.id || '');
        if (channelId) {
          const { error } = await supabase
            .from('channels')
            .update({ is_active: channelActive })
            .eq('id', channelId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from('channels')
            .insert({ name: channelName, is_active: channelActive })
            .select('id')
            .single();
          if (error) throw error;
          channelId = data.id;
        }
        importedChannels += 1;

        const [{ data: byUsername }, { data: byScope }] = await Promise.all([
          supabase.from('agents').select('id').eq('username', username).maybeSingle(),
          supabase.from('agents').select('id').eq('product_id', productId).eq('channel_id', channelId).eq('name', agentName).maybeSingle(),
        ]);

        if (byUsername && byScope && byUsername.id !== byScope.id) {
          errors.push(`第 ${line} 行登录账号与渠道代理商指向不同已有账号`);
          continue;
        }

        const existingId = byUsername?.id || byScope?.id || null;
        if (!existingId && !password) {
          errors.push(`第 ${line} 行新建代理必须填写密码`);
          continue;
        }

        if (existingId) {
          const updatePayload: Record<string, unknown> = {
            channel_id: channelId,
            product_id: productId,
            name: agentName,
            username,
            creative_types: creativeTypes,
            feishu_webhook: feishuWebhook,
            is_active: agentActive,
          };
          if (password) {
            updatePayload.password_hash = await hashPassword(password);
            updatePayload.password_plaintext = password;
          }
          const { error } = await supabase.from('agents').update(updatePayload).eq('id', existingId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('agents').insert({
            channel_id: channelId,
            product_id: productId,
            name: agentName,
            username,
            creative_types: creativeTypes,
            feishu_webhook: feishuWebhook,
            password_hash: await hashPassword(password!),
            password_plaintext: password!,
            is_active: agentActive,
          });
          if (error) throw error;
        }
        importedAgents += 1;
      } catch (error) {
        errors.push(`第 ${line} 行导入失败: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      data: { importedChannels, importedAgents, errors },
      message: `已导入/更新 ${importedAgents} 个代理账号`,
    });
  } catch (error) {
    console.error('POST /api/management/import error:', error);
    return NextResponse.json({ success: false, error: 'Failed to import accounts' }, { status: 500 });
  }
}
