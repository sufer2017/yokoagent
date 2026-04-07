import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { signToken } from '@/lib/auth/jwt';
import type { LoginRequest } from '@/types/auth';
import { mockAgents } from '@/lib/mock/seed';

const COOKIE_NAME = 'yokoagent_token';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'yzy19990704@';

function hasSupabaseConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

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
      const { name } = body;
      if (!name || !name.trim()) {
        return NextResponse.json(
          { success: false, message: '请输入姓名' },
          { status: 400 }
        );
      }

      let agent: { id: string; name: string; is_active: boolean } | null = null;

      if (hasSupabaseConfig()) {
        const supabase = createServerSupabase();
        const { data, error } = await supabase
          .from('agents')
          .select('id, name, is_active')
          .eq('name', name.trim())
          .single();

        if (!error && data) {
          agent = data;
        }
      } else {
        const fallbackAgent = mockAgents.find((item) => item.name === name.trim());
        if (fallbackAgent) {
          agent = {
            id: fallbackAgent.id,
            name: fallbackAgent.name,
            is_active: fallbackAgent.is_active,
          };
        }
      }

      if (!agent) {
        return NextResponse.json(
          { success: false, message: '该姓名不在代理池中，请联系管理员' },
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
      });

      const response = NextResponse.json({
        success: true,
        message: '登录成功',
        session: { role: 'agent', agentId: agent.id, agentName: agent.name },
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
