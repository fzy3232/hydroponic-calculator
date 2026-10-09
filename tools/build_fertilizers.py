# -*- coding: utf-8 -*-
"""
从化学式精确计算水培肥料的元素质量分数，生成自建肥料库。
- 数据来源 = 化学式 + IUPAC 原子量（事实性数据，完全独立可复算，不复制任何现有数据库）
- 氮按硝态/铵态拆分（no3_ratio 为化学事实：硝酸盐=1.0，铵盐=0.0，硝酸铵=0.5）
- 螯合物等无法按化学式表达者，直接给定元素标称含量（override）
"""
import json, re, os, csv
from collections import defaultdict

ATOMIC = {
    'H': 1.008, 'B': 10.81, 'C': 12.011, 'N': 14.007, 'O': 15.999,
    'Na': 22.990, 'Mg': 24.305, 'Si': 28.085, 'P': 30.974, 'S': 32.06,
    'Cl': 35.45, 'K': 39.098, 'Ca': 40.078, 'Mn': 54.938, 'Fe': 55.845,
    'Cu': 63.546, 'Zn': 65.38, 'Mo': 95.95,
}

# 输出给界面的元素字段（与原程序同构的 16 个营养指标）
ELEMS = ['NO3-N', 'NH4-N', 'P', 'K', 'Ca', 'Mg', 'S',
         'Fe', 'Mn', 'Zn', 'Cu', 'B', 'Mo', 'Si', 'Na', 'Cl']


def read_num(s, i):
    j = i
    while j < len(s) and (s[j].isdigit() or s[j] == '.'):
        j += 1
    if j == i:
        return 1.0, i
    return float(s[i:j]), j


def parse_group(s, i=0):
    counts = defaultdict(float)
    while i < len(s):
        c = s[i]
        if c == '(':
            sub, i = parse_group(s, i + 1)
            n, i = read_num(s, i)
            for k, v in sub.items():
                counts[k] += v * n
        elif c == ')':
            return counts, i + 1
        elif c.isupper():
            sym = c
            i += 1
            while i < len(s) and s[i].islower():
                sym += s[i]
                i += 1
            n, i = read_num(s, i)
            counts[sym] += n
        else:
            i += 1
    return counts, i


def parse_formula(f):
    total = defaultdict(float)
    for part in re.split(r'[·.*]', f):
        part = part.strip()
        if not part:
            continue
        m = re.match(r'^(\d+(?:\.\d+)?)(.*)$', part)
        mult, body = (float(m.group(1)), m.group(2)) if m else (1.0, part)
        sub, _ = parse_group(body)
        for k, v in sub.items():
            total[k] += v * mult
    return dict(total)


# (中文名, 化学式, 类别, no3_ratio, purity, override_comp, 备注)
FERT = [
    # ── 大量元素 ──
    ("硝酸钙(四水)",        "Ca(NO3)2·4H2O",      "大量", 1.0,  1.0, None, "钙源+硝态氮；吸湿，宜单独存放"),
    ("硝酸钾",              "KNO3",               "大量", 1.0,  1.0, None, "钾源+硝态氮，水培最常用"),
    ("磷酸二氢钾",          "KH2PO4",             "大量", None, 1.0, None, "磷钾同补，也用于调 pH"),
    ("硫酸镁(七水)",        "MgSO4·7H2O",         "大量", None, 1.0, None, "镁源+硫；与钙肥不可高浓度混合"),
    ("硫酸钾",              "K2SO4",              "大量", None, 1.0, None, "无氮钾源"),
    ("硝酸铵",              "NH4NO3",             "大量", 0.5,  1.0, None, "硝态铵态各半；铵态占比需谨慎"),
    ("磷酸二氢铵",          "NH4H2PO4",           "大量", 0.0,  1.0, None, "铵态氮+磷"),
    ("磷酸氢二铵",          "(NH4)2HPO4",         "大量", 0.0,  1.0, None, "铵态氮+磷"),
    ("氯化钾",              "KCl",                "大量", None, 1.0, None, "廉价钾源，忌氯作物慎用"),
    ("硝酸钠",              "NaNO3",              "大量", 1.0,  1.0, None, "硝态氮+钠"),
    ("硫酸铵",              "(NH4)2SO4",          "大量", 0.0,  1.0, None, "纯铵态氮，酸性肥料"),
    ("磷酸(85%)",           "H3PO4",              "大量", None, 0.85, None, "调 pH + 补磷；强酸"),
    ("硝酸(68%)",           "HNO3",               "大量", 1.0,  0.68, None, "调 pH + 补硝态氮；强酸"),
    ("碳酸钾",              "K2CO3",              "大量", None, 1.0, None, "钾源，碱性"),
    ("碳酸氢钾",            "KHCO3",              "大量", None, 1.0, None, "钾源+碱度"),
    ("氢氧化钾",            "KOH",                "大量", None, 1.0, None, "调 pH 用，强碱"),
    ("硫酸钙(二水)",        "CaSO4·2H2O",         "大量", None, 1.0, None, "钙源，微溶"),
    ("氯化钙(二水)",        "CaCl2·2H2O",         "大量", None, 1.0, None, "钙源，含氯"),
    ("硝酸镁(六水)",        "Mg(NO3)2·6H2O",      "大量", 1.0,  1.0, None, "镁源+硝态氮"),
    ("硫酸钠",              "Na2SO4",             "大量", None, 1.0, None, "调节钠/硫"),
    ("磷酸二氢钠(二水)",    "NaH2PO4·2H2O",       "大量", None, 1.0, None, "磷源，含钠"),
    ("氯化钠",              "NaCl",               "大量", None, 1.0, None, "补钠/氯"),
    ("硅酸钾",              "K2SiO3",             "大量", None, 1.0, None, "硅源+钾（抗病、抗倒伏）"),
    ("硅酸钠(九水)",        "Na2SiO3·9H2O",       "大量", None, 1.0, None, "硅源，碱性"),
    # ── 微量元素 ──
    ("硼酸",                "H3BO3",              "微量", None, 1.0, None, "硼源；过量易毒害"),
    ("硼砂(十水)",          "Na2B4O7·10H2O",      "微量", None, 1.0, None, "硼源+钠"),
    ("硫酸锰(一水)",        "MnSO4·H2O",          "微量", None, 1.0, None, "锰源"),
    ("硫酸锌(七水)",        "ZnSO4·7H2O",         "微量", None, 1.0, None, "锌源"),
    ("硫酸铜(五水)",        "CuSO4·5H2O",         "微量", None, 1.0, None, "铜源；极微量即致毒"),
    ("钼酸钠(二水)",        "Na2MoO4·2H2O",       "微量", None, 1.0, None, "钼源+钠"),
    ("钼酸铵(四水)",        "(NH4)6Mo7O24·4H2O",  "微量", 0.0,  1.0, None, "钼源+铵态氮"),
    ("硫酸亚铁(七水)",      "FeSO4·7H2O",         "微量", None, 1.0, None, "铁源；易氧化沉淀，需螯合或现配"),
    # 螯合铁：配合物无法按化学式表达，采用业界标称含量
    ("螯合铁 Fe-EDTA",      "-",                  "微量", None, 1.0, {'Fe': 13.0}, "最常用铁源，pH<6.5 稳定"),
    ("螯合铁 Fe-DTPA",      "-",                  "微量", None, 1.0, {'Fe': 11.0}, "适用 pH 范围更宽(pH<7.5)"),
    ("螯合铁 Fe-EDDHA",     "-",                  "微量", None, 1.0, {'Fe': 6.0},  "高 pH 仍有效，价格高"),
]

# 行业通用的标准水培原料组合：智能推荐优先从中选取，
# 避免选出"用微量元素肥料（如钼酸铵）去补大量元素（铵态氮）"这类会严重超标的组合
STD_SET = {
    '硝酸钙(四水)', '硝酸钾', '磷酸二氢钾', '硫酸镁(七水)', '硫酸钾',
    '螯合铁 Fe-EDTA', '硼酸', '硫酸锰(一水)', '硫酸锌(七水)', '硫酸铜(五水)', '钼酸钠(二水)',
}


def analyze(formula, no3_ratio, purity, override):
    if override:
        comp = {k: 0.0 for k in ELEMS}
        for k, v in override.items():
            comp[k] = v
        return None, comp

    counts = parse_formula(formula)
    mw = sum(ATOMIC[e] * n for e, n in counts.items())
    pct = {}
    for e, n in counts.items():
        pct[e] = ATOMIC[e] * n / mw * 100.0

    comp = {k: 0.0 for k in ELEMS}
    n_total = pct.get('N', 0.0)
    if n_total:
        if no3_ratio is None:
            no3_ratio = 1.0
        comp['NO3-N'] = n_total * no3_ratio
        comp['NH4-N'] = n_total * (1.0 - no3_ratio)
    for e in ('P', 'K', 'Ca', 'Mg', 'S', 'Fe', 'Mn', 'Zn', 'Cu', 'B', 'Mo', 'Si', 'Na', 'Cl'):
        comp[e] = pct.get(e, 0.0)
    for k in comp:
        comp[k] = round(comp[k], 4)
    return mw, comp


FORM_NAMES = {0: '无水', 1: '一水合物', 2: '二水合物', 3: '三水合物', 4: '四水合物',
              5: '五水合物', 6: '六水合物', 7: '七水合物', 8: '八水合物',
              9: '九水合物', 10: '十水合物', 12: '十二水合物'}


def hydrate_count(formula):
    """从化学式解析结晶水个数（0 表示无水）"""
    if not formula or formula == '-':
        return 0
    m = re.search(r'[·.*](\d*)\s*H2O\b', formula)
    if m:
        return int(m.group(1)) if m.group(1) else 1
    return 0


def anhydrous_formula(formula):
    """去掉结晶水部分的化学式；本来就无水则返回 None"""
    if not formula or formula == '-' or not re.search(r'[·.*]', formula):
        return None
    return re.split(r'[·.*]', formula)[0]


def anhydrous_comp(formula, purity):
    """计算无水形态下的元素含量（%）"""
    af = anhydrous_formula(formula)
    if not af:
        return None
    counts = parse_formula(af)
    mw = sum(ATOMIC[e] * n for e, n in counts.items())
    out = {}
    for e, n in counts.items():
        out[e] = round(ATOMIC[e] * n / mw * 100.0 * purity, 4)
    return out


def form_hint(formula, comp, purity):
    """生成形态核对提示：当前是几水合物；若买成无水，含量会变成多少"""
    if formula == '-':
        return '螯合物（按标称含量）', ''
    n = hydrate_count(formula)
    if n == 0:
        return '无水', ''
    label = FORM_NAMES.get(n, f'{n}水合物')
    ac = anhydrous_comp(formula, purity)
    if not ac:
        return label, ''
    parts = []
    for cn, en in (('NO3-N', 'N'), ('NH4-N', 'N'), ('P', 'P'), ('K', 'K'), ('Ca', 'Ca'), ('Mg', 'Mg'),
                   ('S', 'S'), ('Fe', 'Fe'), ('Zn', 'Zn'), ('Cu', 'Cu'), ('Mn', 'Mn'), ('B', 'B'),
                   ('Mo', 'Mo'), ('Si', 'Si'), ('Na', 'Na'), ('Cl', 'Cl')):
        cur = comp.get(cn, 0.0)
        new = ac.get(en, 0.0)
        if cur >= 1.0 and new > cur + 0.01:
            parts.append(f'{cn} {cur:.3f}%→{new:.3f}%（{new/cur:.2f}×）')
    if not parts:
        return label, ''
    af = anhydrous_formula(formula)
    return label, ('若买到的是无水产品，各元素含量会变成：' + '；'.join(parts)
                   + f'。请在 CSV 中把化学式改为 {af} 后重新导入。')


def main():
    out = []
    for name, formula, cat, no3r, purity, override, note in FERT:
        mw, comp = analyze(formula, no3r, purity, override)
        # purity 只影响有效成分，此处保留纯物质含量并按纯度折算有效值
        eff = {k: round(v * purity, 4) for k, v in comp.items()}
        form, hint = form_hint(formula, eff, purity)
        item = {
            'name': name,
            'formula': formula if formula != '-' else '(螯合物，按标称含量)',
            'category': cat,
            'mw': round(mw, 3) if mw else None,
            'purity': purity,
            'comp': eff,                    # 有效元素含量（% ，已含纯度折算）
            'note': note,
            'form': form,                   # 结晶水形态（无水/四水合物/…）
            'form_hint': hint,              # 若买成无水形态的含量变化提示
        }
        # 肥料标签常用的氧化物当量，便于对照商品标识
        if comp.get('P'):
            item['P2O5_eq'] = round(comp['P'] * 141.944 / 61.948, 3)
        if comp.get('K'):
            item['K2O_eq'] = round(comp['K'] * 94.196 / 78.196, 3)
        out.append(item)

    here = os.path.dirname(os.path.abspath(__file__))
    # 脚本已归档到 tools/，所以数据目录在上一级
    data_dir = os.path.join(os.path.dirname(here), 'data')
    os.makedirs(data_dir, exist_ok=True)

    # CSV 作为唯一数据源（Excel 可直接编辑扩充）
    # 数值含义：每 100 g 该商品中所含该元素的克数（已按纯度折算）
    cols = ['名称', '化学式', '类别', '纯度', '形态', '标准'] + ELEMS + ['P2O5当量', 'K2O当量', '备注', '形态提示']
    csv_path = os.path.join(data_dir, 'fertilizers.csv')
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols)
        for it in out:
            w.writerow([it['name'], it['formula'], it['category'], it['purity'], it['form'],
                        1 if it['name'] in STD_SET else 0]
                       + [it['comp'][e] for e in ELEMS]
                       + [it.get('P2O5_eq', ''), it.get('K2O_eq', ''), it['note'], it['form_hint']])
    print(f"生成 data/fertilizers.csv：{len(out)} 种肥料 × {len(cols)} 列")

    with open(os.path.join(data_dir, 'fertilizers.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    # —— 自检：与教科书/肥料标签公认值对照 ——
    print("\n=== 自检（与公认值对照）===")
    checks = {
        '硝酸钾': {'K': 38.67, 'NO3-N': 13.85},
        '磷酸二氢钾': {'P': 22.76, 'K': 28.73},
        '硝酸钙(四水)': {'Ca': 16.97, 'NO3-N': 11.86},
        '硫酸镁(七水)': {'Mg': 9.86, 'S': 13.01},
        '硫酸钾': {'K': 44.87, 'S': 18.40},
        '硼酸': {'B': 17.48},
    }
    allok = True
    for item in out:
        if item['name'] in checks:
            for el, expect in checks[item['name']].items():
                got = item['comp'][el]
                ok = abs(got - expect) < 0.05
                allok &= ok
                print(f"  {item['name']:14s} {el:6s} 计算 {got:7.3f}%  公认 {expect:7.2f}%  {'OK' if ok else '✗ 偏差'}")
    print(f"\n自检结果：{'全部通过' if allok else '存在偏差，需检查解析器'}")


if __name__ == '__main__':
    main()
