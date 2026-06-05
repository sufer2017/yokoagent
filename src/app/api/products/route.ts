import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { mutateLocalDb, newId, nowIso, readLocalDb } from '@/lib/local-db/store';

// GET /api/products - List products for filters and account management
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || (session.role !== 'admin' && session.role !== 'agent')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';

    if (!hasSupabaseConfig()) {
      const db = await readLocalDb();
      const products = db.products
        .filter((product) => !activeOnly || product.is_active)
        .filter((product) => session.role !== 'agent' || product.id === session.productId)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
      return NextResponse.json({ success: true, data: products });
    }

    const supabase = createServerSupabase();
    let query = supabase
      .from('products')
      .select('id, name, is_active, created_at, updated_at')
      .order('name');

    if (activeOnly) query = query.eq('is_active', true);
    if (session.role === 'agent' && session.productId) query = query.eq('id', session.productId);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('GET /api/products error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch products' }, { status: 500 });
  }
}

// POST /api/products - Create product
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ success: false, error: '请输入产品名称' }, { status: 400 });
    }

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        if (db.products.some((product) => product.name === name)) {
          throw new Error('产品已存在');
        }
        const timestamp = nowIso();
        const product = {
          id: newId(),
          name,
          is_active: body.is_active ?? true,
          created_at: timestamp,
          updated_at: timestamp,
        };
        db.products.push(product);
        return product;
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('products')
      .insert({ name, is_active: body.is_active ?? true })
      .select('id, name, is_active, created_at, updated_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ success: false, error: '产品已存在' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('POST /api/products error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to create product' }, { status: 500 });
  }
}
