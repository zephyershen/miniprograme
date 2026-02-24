#!/usr/bin/env python3
import sys
import os
import re

def parse_size(size_str):
    """解析大小字符串，返回字节数"""
    match = re.match(r'^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$', size_str.strip())
    if not match:
        return None
    
    value = float(match.group(1))
    unit = match.group(2).upper()
    
    units = {
        'B': 1,
        'KB': 1024,
        'MB': 1024 ** 2,
        'GB': 1024 ** 3,
        'TB': 1024 ** 4,
        'KIB': 1024,
        'MIB': 1024 ** 2,
        'GIB': 1024 ** 3,
        'TIB': 1024 ** 4,
    }
    
    if unit not in units:
        return None
    
    return int(value * units[unit])

def format_size(bytes_size):
    """将字节数格式化为可读大小"""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_size < 1024:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024
    return f"{bytes_size:.2f} PB"

def find_large_files(directory, min_size_bytes):
    """查找大于指定大小的文件"""
    large_files = []
    
    for root, dirs, files in os.walk(directory):
        for filename in files:
            filepath = os.path.join(root, filename)
            try:
                file_size = os.path.getsize(filepath)
                if file_size > min_size_bytes:
                    large_files.append((filepath, file_size))
            except (OSError, IOError):
                continue
    
    return sorted(large_files, key=lambda x: x[1], reverse=True)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法: python3 check_file_size.py <目录路径> <大小阈值>")
        print("示例: python3 check_file_size.py /path/to/dir 100KB")
        print("      python3 check_file_size.py /path/to/dir 5MB")
        print("      python3 check_file_size.py /path/to/dir 1GB")
        print("支持单位: B, KB, MB, GB, TB")
        sys.exit(1)
    
    directory = sys.argv[1]
    size_str = sys.argv[2]
    
    if not os.path.isdir(directory):
        print(f"错误: 目录不存在 - {directory}")
        sys.exit(1)
    
    min_size = parse_size(size_str)
    if min_size is None:
        print(f"错误: 无效的大小格式 - {size_str}")
        print("支持的单位: B, KB, MB, GB, TB")
        sys.exit(1)
    
    print(f"正在搜索 {directory} 中大于 {size_str} 的文件...\n")
    
    large_files = find_large_files(directory, min_size)
    
    if large_files:
        print(f"找到 {len(large_files)} 个文件大于 {size_str}:\n")
        for filepath, size in large_files:
            print(f"  {format_size(size):>12}  {filepath}")
    else:
        print(f"没有找到大于 {size_str} 的文件")
