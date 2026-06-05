import { NextResponse } from 'next/server';
import { createServerSupabase, hasSupabaseConfig } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';
import { mutateLocalDb, nowIso } from '@/lib/local-db/store';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = String(body.name || '').trim();
    if (body.is_active !== undefined) updateData.is_active = Boolean(body.is_active);

    if (!hasSupabaseConfig()) {
      const data = await mutateLocalDb((db) => {
        const product = db.products.find((item) => item.id === id);
        if (!product) throw new Error('Product not found');
        Object.assign(product, updateData, { updated_at: nowIso() });
        return product;
      });

      return NextResponse.json({ success: true, data });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select('id, name, is_active, created_at, updated_at')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('PATCH /api/products/[id] error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to update product' }, { status: 500 });
  }
}
