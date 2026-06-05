'use client';

import React, { useMemo } from 'react';
import { Checkbox, Divider, Select, Space, Typography } from 'antd';

const { Text } = Typography;

interface MbiMultiSelectOption {
  value: string;
  label: string;
}

interface MbiMultiSelectProps {
  value: string[];
  options: MbiMultiSelectOption[];
  placeholder: string;
  style?: React.CSSProperties;
  showSearch?: boolean;
  maxTagCount?: number | 'responsive';
  onChange: (value: string[]) => void;
}

export default function MbiMultiSelect({
  value,
  options,
  placeholder,
  style,
  showSearch = true,
  maxTagCount = 1,
  onChange,
}: MbiMultiSelectProps) {
  const optionValues = useMemo(() => options.map((option) => option.value), [options]);
  const optionValueSet = useMemo(() => new Set(optionValues), [optionValues]);
  const selectedOptionValues = useMemo(
    () => value.filter((item) => optionValueSet.has(item)),
    [optionValueSet, value]
  );
  const allSelected = optionValues.length > 0 && selectedOptionValues.length === optionValues.length;
  const partlySelected = selectedOptionValues.length > 0 && !allSelected;

  const toggleAll = () => {
    onChange(allSelected ? [] : optionValues);
  };

  return (
    <Select
      mode="multiple"
      allowClear
      showSearch={showSearch}
      maxTagCount={maxTagCount}
      maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
      optionFilterProp="label"
      placeholder={placeholder}
      value={selectedOptionValues}
      style={style}
      onChange={onChange}
      options={options}
      popupRender={(menu) => (
        <div>
          <div
            className="mbi-select-all-row"
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleAll}
          >
            <Space>
              <Checkbox checked={allSelected} indeterminate={partlySelected} />
              <Text strong>全选当前项</Text>
              <Text type="secondary">{selectedOptionValues.length}/{optionValues.length}</Text>
            </Space>
          </div>
          <Divider style={{ margin: '4px 0' }} />
          {menu}
        </div>
      )}
    />
  );
}
