import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { signToken } from '@/lib/auth/jwt';
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
      const supabase = createServerSupabase();
      const { name } = body;
      if (!name || !name.trim()) {
        return NextResponse.json(
          { success: false, message: '请输入姓名' },
          { status: 400 }
        );
      }

      const { data: agent, error } = await supabase
        .from('agents')
        .select('id, name, is_active')
        .eq('name', name.trim())
        .single();

      if (error || !agent) {
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
