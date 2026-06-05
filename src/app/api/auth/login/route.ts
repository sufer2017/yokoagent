import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { signToken } from '@/lib/auth/jwt';
import { comparePassword } from '@/lib/auth/password';
import { channelName, productName, readLocalDb } from '@/lib/local-db/store';
import type { LoginRequest } from '@/types/auth';

const COOKIE_NAME = 'yokoagent_token';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'yzy19990704@';

export async function POST(request: Request) {
  try {
    const body: LoginRequest = await request.json();
    const { role } = body;

    if (!role || !['agent', 'admin'].includes(role)) {
      return NextResponse.json(
        { success: false, message: '请选择角色' },
        { status: 400 }
      );
    }

    // ---- Agent Login ----
    if (role === 'agent') {
      const { username, password } = body;
      if (!username || !username.trim() || !password) {
        return NextResponse.json(
          { success: false, message: '请输入代理账号和密码' },
          { status: 400 }
        );
      }

      let agent: {
        id: string;
        name: string;
        username: string;
        password_hash: string;
        product_id: string;
        product_name: string;
        channel_id: string;
        channel_name: string;
        is_active: boolean;
      } | null = null;

      if (hasSupabaseConfig()) {
        const supabase = createServerSupabase();
        const { data, error } = await supabase
          .from('agents')
          .select('id, name, username, password_hash, product_id, channel_id, is_active, products(name), channels(name)')
          .eq('username', username.trim())
          .single();

        if (!error && data) {
          const product = Array.isArray(data.products) ? data.products[0] : data.products;
          const channel = Array.isArray(data.channels) ? data.channels[0] : data.channels;
          agent = {
            id: data.id,
            name: data.name,
            username: data.username,
            password_hash: data.password_hash,
            product_id: data.product_id,
            product_name: product?.name || '',
            channel_id: data.channel_id,
            channel_name: channel?.name || '',
            is_active: data.is_active,
          };
        }
      } else {
        const db = await readLocalDb();
        const localAgent = db.agents.find((item) => item.username === username.trim());
        if (localAgent) {
          agent = {
            id: localAgent.id,
            name: localAgent.name,
            username: localAgent.username,
            password_hash: localAgent.password_hash,
            product_id: localAgent.product_id,
            product_name: productName(db, localAgent.product_id),
            channel_id: localAgent.channel_id,
            channel_name: channelName(db, localAgent.channel_id),
            is_active: localAgent.is_active,
          };
        }
      }

      if (!agent) {
        return NextResponse.json(
          { success: false, message: '代理账号不存在，请联系管理员' },
          { status: 401 }
        );
      }

      const passwordOk = await comparePassword(password, agent.password_hash);
      if (!passwordOk) {
        return NextResponse.json(
          { success: false, message: '代理账号或密码错误' },
          { status: 401 }
        );
      }

      if (!agent.is_active) {
        return NextResponse.json(
          { success: false, message: '该账号已被停用，请联系管理员' },
          { status: 401 }
        );
      }

      const token = await signToken({
        role: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        productId: agent.product_id,
        productName: agent.product_name,
        channelId: agent.channel_id,
        channelName: agent.channel_name,
      });

      const response = NextResponse.json({
        success: true,
        message: '登录成功',
        session: {
          role: 'agent',
          agentId: agent.id,
          agentName: agent.name,
          productId: agent.product_id,
          productName: agent.product_name,
          channelId: agent.channel_id,
          channelName: agent.channel_name,
        },
      });

      response.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
      });

      return response;
    }

    // ---- Admin Login ----
    if (role === 'admin') {
      const { username, password } = body;
      if (!username || !password) {
        return NextResponse.json(
          { success: false, message: '请输入账号和密码' },
          { status: 400 }
        );
      }

      if (
        username.trim() !== ADMIN_USERNAME ||
        password !== ADMIN_PASSWORD
      ) {
        return NextResponse.json(
          { success: false, message: '账号或密码错误' },
          { status: 401 }
        );
      }

      const token = await signToken({ role: 'admin' });

      const response = NextResponse.json({
        success: true,
        message: '登录成功',
        session: { role: 'admin' },
      });

      response.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
      });

      return response;
    }

    return NextResponse.json(
      { success: false, message: '无效的角色' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { success: false, message: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
