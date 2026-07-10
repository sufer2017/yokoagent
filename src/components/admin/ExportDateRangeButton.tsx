'use client';

import React, { useState } from 'react';
import { Button, DatePicker, Modal, Space, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;
const { Text } = Typography;

interface ExportDateRangeButtonProps {
  initialRange: [Dayjs, Dayjs];
  buildHref: (range: [Dayjs, Dayjs]) => string;
  label?: string;
}

function orderedRange(range: [Dayjs, Dayjs]): [Dayjs, Dayjs] {
  return range[0].isAfter(range[1]) ? [range[1], range[0]] : range;
}

export function ExportDateRangeButton({
  initialRange,
  buildHref,
  label = '导出真实明细 CSV',
}: ExportDateRangeButtonProps) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => orderedRange(initialRange));

  const openModal = () => {
    setRange(orderedRange(initialRange));
    setOpen(true);
  };

  const exportCsv = () => {
    window.location.href = buildHref(orderedRange(range));
    setOpen(false);
  };

  return (
    <>
      <Button icon={<DownloadOutlined />} onClick={openModal}>{label}</Button>
      <Modal
        title="选择导出日期范围"
        open={open}
        okText="导出 CSV"
        onOk={exportCsv}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Text strong>日期范围</Text>
          <RangePicker
            value={range}
            allowClear={false}
            style={{ width: '100%' }}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) {
                setRange(orderedRange([value[0], value[1]]));
              }
            }}
          />
        </Space>
      </Modal>
    </>
  );
}
