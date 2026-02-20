/**
 * teamDatabase.js
 * Comprehensive football/soccer team database for Chinese-language sports application.
 * Maps Chinese team names to league classification, abbreviations, and aliases.
 *
 * Each entry: { name, league, abbr, aliases }
 *   - name: canonical Chinese short name (what users commonly type)
 *   - league: league tag from LEAGUE_TAGS
 *   - abbr: official 3-letter abbreviation (Opta/broadcast)
 *   - aliases: alternative Chinese names, long-form names, nicknames
 */

// ============================================================
//  LEAGUE TAGS
// ============================================================
export const LEAGUE_TAGS = [
  '英超', '英冠', '西甲', '西乙', '意甲', '意乙',
  '德甲', '德乙', '法甲', '法乙', '荷甲', '葡超',
  '土超', '比甲', '苏超', '奥甲', '瑞超', '希超',
  '捷甲', '克甲', '塞超', '丹超', '瑞典超', '挪超',
  '沙特联', '中超', '美职联', '日职', '韩K', '澳超',
  '国际赛', '其他',
];

// ============================================================
//  TEAM DATABASE
// ============================================================
export const TEAM_DB = [

  // ----------------------------------------------------------
  //  英超 Premier League (20 teams) 2024-25 / 2025-26
  // ----------------------------------------------------------
  { name: '曼城', league: '英超', abbr: 'MCI', aliases: ['曼彻斯特城', '蓝月亮', '曼城队', 'Manchester City'] },
  { name: '阿森纳', league: '英超', abbr: 'ARS', aliases: ['阿森纳队', '枪手', '兵工厂', 'Arsenal'] },
  { name: '利物浦', league: '英超', abbr: 'LIV', aliases: ['利物浦队', '红军', 'Liverpool'] },
  { name: '切尔西', league: '英超', abbr: 'CHE', aliases: ['切尔西队', '蓝军', 'Chelsea'] },
  { name: '曼联', league: '英超', abbr: 'MUN', aliases: ['曼彻斯特联', '红魔', '曼联队', 'Manchester United'] },
  { name: '热刺', league: '英超', abbr: 'TOT', aliases: ['托特纳姆热刺', '托特纳姆', '热刺队', 'Tottenham'] },
  { name: '纽卡斯尔联', league: '英超', abbr: 'NEW', aliases: ['纽卡斯尔', '纽卡', '喜鹊', '纽卡联', 'Newcastle'] },
  { name: '阿斯顿维拉', league: '英超', abbr: 'AVL', aliases: ['维拉', '阿斯顿维拉队', 'Aston Villa'] },
  { name: '伯恩茅斯', league: '英超', abbr: 'BOU', aliases: ['伯恩茅斯队', '樱桃', 'Bournemouth'] },
  { name: '布莱顿', league: '英超', abbr: 'BHA', aliases: ['布莱顿队', '海鸥', '布莱顿霍夫', 'Brighton'] },
  { name: '布伦特福德', league: '英超', abbr: 'BRE', aliases: ['布伦特福德队', '蜜蜂', 'Brentford'] },
  { name: '水晶宫', league: '英超', abbr: 'CRY', aliases: ['水晶宫队', '鹰', 'Crystal Palace'] },
  { name: '埃弗顿', league: '英超', abbr: 'EVE', aliases: ['埃弗顿队', '太妃糖', 'Everton'] },
  { name: '富勒姆', league: '英超', abbr: 'FUL', aliases: ['富勒姆队', 'Fulham'] },
  { name: '伊普斯维奇', league: '英超', abbr: 'IPS', aliases: ['伊普斯维奇城', '伊普斯维奇队', 'Ipswich'] },
  { name: '莱斯特城', league: '英超', abbr: 'LEI', aliases: ['莱斯特', '狐狸', '莱斯特城队', 'Leicester'] },
  { name: '诺丁汉森林', league: '英超', abbr: 'NFO', aliases: ['诺森', '森林', '诺丁汉', 'Nottingham Forest'] },
  { name: '南安普顿', league: '英超', abbr: 'SOU', aliases: ['南安普敦', '圣徒', '南安普顿队', 'Southampton'] },
  { name: '西汉姆联', league: '英超', abbr: 'WHU', aliases: ['西汉姆', '铁锤帮', '西汉姆联队', 'West Ham'] },
  { name: '狼队', league: '英超', abbr: 'WOL', aliases: ['伍尔弗汉普顿', '狼队队', '伍尔弗', 'Wolves'] },

  // ----------------------------------------------------------
  //  英冠 Championship (24 teams)
  // ----------------------------------------------------------
  { name: '利兹联', league: '英冠', abbr: 'LEE', aliases: ['利兹', '利兹联队', 'Leeds'] },
  { name: '伯恩利', league: '英冠', abbr: 'BUR', aliases: ['伯恩利队', 'Burnley'] },
  { name: '谢菲尔德联', league: '英冠', abbr: 'SHU', aliases: ['谢菲联', '谢联', '谢菲尔德联队', 'Sheffield United'] },
  { name: '卢顿', league: '英冠', abbr: 'LUT', aliases: ['卢顿队', '卢顿城', 'Luton'] },
  { name: '桑德兰', league: '英冠', abbr: 'SUN', aliases: ['桑德兰队', '黑猫', 'Sunderland'] },
  { name: '米德尔斯堡', league: '英冠', abbr: 'MID', aliases: ['米堡', '米德尔斯堡队', 'Middlesbrough'] },
  { name: '西布朗', league: '英冠', abbr: 'WBA', aliases: ['西布罗姆维奇', '西布朗队', 'West Brom'] },
  { name: '诺维奇', league: '英冠', abbr: 'NOR', aliases: ['诺维奇城', '金丝雀', 'Norwich'] },
  { name: '考文垂', league: '英冠', abbr: 'COV', aliases: ['考文垂城', '考文垂队', 'Coventry'] },
  { name: '斯托克城', league: '英冠', abbr: 'STK', aliases: ['斯托克', 'Stoke'] },
  { name: '布里斯托尔城', league: '英冠', abbr: 'BRC', aliases: ['布里斯托城', '布城', 'Bristol City'] },
  { name: '赫尔城', league: '英冠', abbr: 'HUL', aliases: ['赫尔', 'Hull City'] },
  { name: '斯旺西', league: '英冠', abbr: 'SWA', aliases: ['斯旺西城', '天鹅', 'Swansea'] },
  { name: '普利茅斯', league: '英冠', abbr: 'PLY', aliases: ['普利茅斯队', 'Plymouth'] },
  { name: '布莱克本', league: '英冠', abbr: 'BLB', aliases: ['布莱克本流浪者', 'Blackburn'] },
  { name: '米尔沃尔', league: '英冠', abbr: 'MIL', aliases: ['米尔沃尔队', 'Millwall'] },
  { name: '卡迪夫城', league: '英冠', abbr: 'CAR', aliases: ['卡迪夫', 'Cardiff'] },
  { name: '谢菲尔德星期三', league: '英冠', abbr: 'SHW', aliases: ['谢周三', '谢菲星期三', 'Sheffield Wednesday'] },
  { name: '女王公园巡游者', league: '英冠', abbr: 'QPR', aliases: ['QPR', '女王公园', 'Queens Park Rangers'] },
  { name: '沃特福德', league: '英冠', abbr: 'WAT', aliases: ['沃特福德队', '大黄蜂', 'Watford'] },
  { name: '普雷斯顿', league: '英冠', abbr: 'PNE', aliases: ['普雷斯顿队', 'Preston'] },
  { name: '德比郡', league: '英冠', abbr: 'DER', aliases: ['德比', 'Derby'] },
  { name: '朴茨茅斯', league: '英冠', abbr: 'POR', aliases: ['朴茨茅斯队', 'Portsmouth'] },
  { name: '牛津联', league: '英冠', abbr: 'OXF', aliases: ['牛津联队', '牛津', 'Oxford United'] },

  // ----------------------------------------------------------
  //  西甲 La Liga (20 teams)
  // ----------------------------------------------------------
  { name: '巴萨', league: '西甲', abbr: 'BAR', aliases: ['巴塞罗那', '巴塞', '巴萨队', 'Barcelona'] },
  { name: '皇马', league: '西甲', abbr: 'RMA', aliases: ['皇家马德里', '白衣军团', '皇马队', 'Real Madrid'] },
  { name: '马竞', league: '西甲', abbr: 'ATM', aliases: ['马德里竞技', '床单军团', '马竞队', 'Atletico Madrid'] },
  { name: '皇家社会', league: '西甲', abbr: 'RSO', aliases: ['皇社', '社会', 'Real Sociedad'] },
  { name: '皇家贝蒂斯', league: '西甲', abbr: 'BET', aliases: ['贝蒂斯', 'Real Betis'] },
  { name: '比利亚雷亚尔', league: '西甲', abbr: 'VIL', aliases: ['比利亚雷亚尔队', '黄色潜水艇', '黄潜', '维拉利尔', 'Villarreal'] },
  { name: '赫罗纳', league: '西甲', abbr: 'GIR', aliases: ['赫罗纳队', '吉罗纳', 'Girona'] },
  { name: '塞维利亚', league: '西甲', abbr: 'SEV', aliases: ['塞维利亚队', 'Sevilla'] },
  { name: '塞尔塔', league: '西甲', abbr: 'CEL', aliases: ['维戈塞尔塔', '塞尔塔队', 'Celta Vigo'] },
  { name: '马洛卡', league: '西甲', abbr: 'MAL', aliases: ['马略卡', '皇家马洛卡', 'Mallorca'] },
  { name: '巴列卡诺', league: '西甲', abbr: 'RAY', aliases: ['巴列卡诺队', '闪电', 'Rayo Vallecano'] },
  { name: '阿拉维斯', league: '西甲', abbr: 'ALV', aliases: ['阿拉维斯队', '德波蒂沃阿拉维斯', 'Alaves'] },
  { name: '瓦伦西亚', league: '西甲', abbr: 'VAL', aliases: ['瓦伦西亚队', '蝙蝠军团', 'Valencia'] },
  { name: '西班牙人', league: '西甲', abbr: 'ESP', aliases: ['RCD西班牙人', '爱斯帕尼奥尔', 'Espanyol'] },
  { name: '赫塔费', league: '西甲', abbr: 'GET', aliases: ['赫塔菲', '赫塔费队', 'Getafe'] },
  { name: '奥萨苏纳', league: '西甲', abbr: 'OCA', aliases: ['奥萨苏纳队', 'Osasuna'] },
  { name: '莱加内斯', league: '西甲', abbr: 'LEG', aliases: ['莱加内斯队', 'Leganes'] },
  { name: '巴拉多利德', league: '西甲', abbr: 'VLL', aliases: ['巴利亚多利德', '巴拉多利德队', 'Valladolid'] },
  { name: '拉斯帕尔马斯', league: '西甲', abbr: 'LPA', aliases: ['拉斯帕尔马斯队', '帕尔马斯', 'Las Palmas'] },
  { name: '毕尔巴鄂竞技', league: '西甲', abbr: 'ATB', aliases: ['毕尔巴鄂', '毕巴', 'Athletic Bilbao'] },

  // ----------------------------------------------------------
  //  西乙 Segunda División (22 teams)
  // ----------------------------------------------------------
  { name: '萨拉戈萨', league: '西乙', abbr: 'ZAR', aliases: ['皇家萨拉戈萨', 'Zaragoza'] },
  { name: '奥维耶多', league: '西乙', abbr: 'OVI', aliases: ['奥维耶多队', 'Oviedo'] },
  { name: '格拉纳达', league: '西乙', abbr: 'GRA', aliases: ['格拉纳达队', 'Granada'] },
  { name: '埃尔切', league: '西乙', abbr: 'ELC', aliases: ['埃尔切队', 'Elche'] },
  { name: '韦斯卡', league: '西乙', abbr: 'HUE', aliases: ['韦斯卡队', 'Huesca'] },
  { name: '特内里费', league: '西乙', abbr: 'TEN', aliases: ['特内里费队', 'Tenerife'] },
  { name: '卡迪斯', league: '西乙', abbr: 'CAD', aliases: ['加迪斯', '卡迪斯队', 'Cadiz'] },
  { name: '阿尔梅里亚', league: '西乙', abbr: 'ALM', aliases: ['阿尔梅里亚队', 'Almeria'] },
  { name: '桑坦德竞技', league: '西乙', abbr: 'RAC', aliases: ['桑坦德', 'Racing Santander'] },
  { name: '马拉加', league: '西乙', abbr: 'MLG', aliases: ['马拉加队', 'Malaga'] },
  { name: '希洪竞技', league: '西乙', abbr: 'SPG', aliases: ['希洪', '希洪竞技队', 'Sporting Gijon'] },
  { name: '莱万特', league: '西乙', abbr: 'LEV', aliases: ['莱万特队', 'Levante'] },
  { name: '米兰德斯', league: '西乙', abbr: 'MIR', aliases: ['米兰德斯队', 'Mirandes'] },
  { name: '布尔戈斯', league: '西乙', abbr: 'BUR', aliases: ['布尔戈斯队', 'Burgos'] },
  { name: '卡塔赫纳', league: '西乙', abbr: 'CTG', aliases: ['卡塔赫纳队', 'Cartagena'] },
  { name: '阿尔科尔孔', league: '西乙', abbr: 'ALC', aliases: ['阿尔科尔孔队', 'Alcorcon'] },
  { name: '费罗尔竞技', league: '西乙', abbr: 'RFE', aliases: ['费罗尔', 'Racing Ferrol'] },
  { name: '埃瓦尔', league: '西乙', abbr: 'EIB', aliases: ['埃瓦尔队', 'Eibar'] },
  { name: '皇家卡斯蒂利亚', league: '西乙', abbr: 'RMC', aliases: ['卡斯蒂利亚', 'Castilla'] },
  { name: '巴萨B队', league: '西乙', abbr: 'BAB', aliases: ['巴塞罗那B队', 'Barcelona B'] },
  { name: '维尔瓦', league: '西乙', abbr: 'REC', aliases: ['维尔瓦队', '韦尔瓦', 'Recreativo Huelva'] },
  { name: '科尔多瓦', league: '西乙', abbr: 'COR', aliases: ['科尔多瓦队', 'Cordoba'] },

  // ----------------------------------------------------------
  //  意甲 Serie A (20 teams)
  // ----------------------------------------------------------
  { name: '那不勒斯', league: '意甲', abbr: 'NAP', aliases: ['那不勒斯队', '拿波利', 'Napoli'] },
  { name: '尤文图斯', league: '意甲', abbr: 'JUV', aliases: ['尤文', '老妇人', '尤文图斯队', 'Juventus'] },
  { name: '国际米兰', league: '意甲', abbr: 'INT', aliases: ['国米', '蓝黑军团', '国际米兰队', 'Inter Milan'] },
  { name: 'AC米兰', league: '意甲', abbr: 'MIL', aliases: ['米兰', '红黑军团', 'AC米兰队', 'AC Milan'] },
  { name: '亚特兰大', league: '意甲', abbr: 'ATA', aliases: ['阿塔兰塔', '亚特兰大队', 'Atalanta'] },
  { name: '拉齐奥', league: '意甲', abbr: 'LAZ', aliases: ['拉齐奥队', '蓝鹰', 'Lazio'] },
  { name: '罗马', league: '意甲', abbr: 'ROM', aliases: ['罗马队', 'AS罗马', 'Roma'] },
  { name: '佛罗伦萨', league: '意甲', abbr: 'FIO', aliases: ['佛罗伦萨队', '紫百合', '佛罗伦', 'Fiorentina'] },
  { name: '博洛尼亚', league: '意甲', abbr: 'BOL', aliases: ['博洛尼亚队', 'Bologna'] },
  { name: '都灵', league: '意甲', abbr: 'TOR', aliases: ['都灵队', '都灵FC', 'Torino'] },
  { name: '乌迪内斯', league: '意甲', abbr: 'UDI', aliases: ['乌迪内斯队', 'Udinese'] },
  { name: '热那亚', league: '意甲', abbr: 'GEN', aliases: ['热那亚队', 'Genoa'] },
  { name: '卡利亚里', league: '意甲', abbr: 'CAG', aliases: ['卡利亚里队', 'Cagliari'] },
  { name: '恩波利', league: '意甲', abbr: 'EMP', aliases: ['恩波利队', 'Empoli'] },
  { name: '维罗纳', league: '意甲', abbr: 'VER', aliases: ['维罗纳队', '维罗纳希拉斯', 'Hellas Verona'] },
  { name: '蒙扎', league: '意甲', abbr: 'MON', aliases: ['蒙扎队', 'Monza'] },
  { name: '帕尔马', league: '意甲', abbr: 'PAR', aliases: ['帕尔马队', 'Parma'] },
  { name: '科莫', league: '意甲', abbr: 'COM', aliases: ['科莫队', 'Como'] },
  { name: '莱切', league: '意甲', abbr: 'LEC', aliases: ['莱切队', 'Lecce'] },
  { name: '威尼斯', league: '意甲', abbr: 'VEN', aliases: ['威尼斯队', 'Venezia'] },

  // ----------------------------------------------------------
  //  意乙 Serie B (20 teams)
  // ----------------------------------------------------------
  { name: '萨索洛', league: '意乙', abbr: 'SAS', aliases: ['萨索洛队', 'Sassuolo'] },
  { name: '萨勒尼塔纳', league: '意乙', abbr: 'SAL', aliases: ['萨勒尼塔纳队', 'Salernitana'] },
  { name: '布雷西亚', league: '意乙', abbr: 'BRE', aliases: ['布雷西亚队', 'Brescia'] },
  { name: '巴里', league: '意乙', abbr: 'BAR', aliases: ['巴里队', 'Bari'] },
  { name: '帕拉蒙', league: '意乙', abbr: 'PAL', aliases: ['巴勒莫', '帕勒莫', 'Palermo'] },
  { name: '克雷莫纳', league: '意乙', abbr: 'CRE', aliases: ['克雷莫纳队', 'Cremonese'] },
  { name: '卡坦扎罗', league: '意乙', abbr: 'CTZ', aliases: ['卡坦扎罗队', 'Catanzaro'] },
  { name: '桑普多利亚', league: '意乙', abbr: 'SAM', aliases: ['桑普', '桑普多利亚队', 'Sampdoria'] },
  { name: '弗洛西诺内', league: '意乙', abbr: 'FRO', aliases: ['弗洛西诺内队', 'Frosinone'] },
  { name: '斯佩齐亚', league: '意乙', abbr: 'SPE', aliases: ['斯佩齐亚队', 'Spezia'] },
  { name: '摩德纳', league: '意乙', abbr: 'MOD', aliases: ['摩德纳队', 'Modena'] },
  { name: '苏迪蒂罗尔', league: '意乙', abbr: 'SUD', aliases: ['苏迪蒂罗尔队', 'Sudtirol'] },
  { name: '皮亚琴察', league: '意乙', abbr: 'PIA', aliases: ['皮亚琴察队', 'Piacenza'] },
  { name: '雷吉纳', league: '意乙', abbr: 'REG', aliases: ['雷吉纳队', 'Reggiana'] },
  { name: '费拉拉', league: '意乙', abbr: 'SPA', aliases: ['斯帕尔', 'SPAL'] },
  { name: '佩斯卡拉', league: '意乙', abbr: 'PES', aliases: ['佩斯卡拉队', 'Pescara'] },
  { name: '切塞纳', league: '意乙', abbr: 'CES', aliases: ['切塞纳队', 'Cesena'] },
  { name: '曼托瓦', league: '意乙', abbr: 'MAN', aliases: ['曼托瓦队', 'Mantova'] },
  { name: '柯森察', league: '意乙', abbr: 'COS', aliases: ['科森扎', '柯森察队', 'Cosenza'] },
  { name: '尤文图斯B队', league: '意乙', abbr: 'JNG', aliases: ['尤文次队', 'Juventus Next Gen'] },

  // ----------------------------------------------------------
  //  德甲 Bundesliga (18 teams)
  // ----------------------------------------------------------
  { name: '拜仁', league: '德甲', abbr: 'BAY', aliases: ['拜仁慕尼黑', '拜慕', '南部之星', 'Bayern Munich'] },
  { name: '多特蒙德', league: '德甲', abbr: 'BVB', aliases: ['多特', '大黄蜂', '多特蒙德队', 'Borussia Dortmund'] },
  { name: '莱比锡红牛', league: '德甲', abbr: 'RBL', aliases: ['莱比锡', 'RB莱比锡', '莱比锡队', 'RB Leipzig'] },
  { name: '勒沃库森', league: '德甲', abbr: 'LEV', aliases: ['勒沃库森队', '药厂', 'Bayer Leverkusen'] },
  { name: '法兰克福', league: '德甲', abbr: 'SGE', aliases: ['法兰克福队', 'Eintracht Frankfurt'] },
  { name: '门兴格拉德巴赫', league: '德甲', abbr: 'BMG', aliases: ['门兴', '小马驹', '门兴队', 'Monchengladbach'] },
  { name: '沃尔夫斯堡', league: '德甲', abbr: 'WOB', aliases: ['狼堡', '沃尔夫斯堡队', 'Wolfsburg'] },
  { name: '弗赖堡', league: '德甲', abbr: 'FRE', aliases: ['弗莱堡', '弗赖堡队', 'Freiburg'] },
  { name: '霍芬海姆', league: '德甲', abbr: 'TSG', aliases: ['霍芬海姆队', '霍村', 'Hoffenheim'] },
  { name: '柏林联合', league: '德甲', abbr: 'UNB', aliases: ['柏林联', '柏林联合队', 'Union Berlin'] },
  { name: '美因茨', league: '德甲', abbr: 'MAI', aliases: ['美因茨队', '美因茨05', 'Mainz'] },
  { name: '奥格斯堡', league: '德甲', abbr: 'AUG', aliases: ['奥格斯堡队', 'Augsburg'] },
  { name: '斯图加特', league: '德甲', abbr: 'STU', aliases: ['斯图加特队', 'Stuttgart'] },
  { name: '海登海姆', league: '德甲', abbr: 'HEI', aliases: ['海登海姆队', 'Heidenheim'] },
  { name: '波鸿', league: '德甲', abbr: 'BOC', aliases: ['波鸿队', 'Bochum'] },
  { name: '不莱梅', league: '德甲', abbr: 'SVW', aliases: ['云达不莱梅', '不莱梅队', 'Werder Bremen'] },
  { name: '荷尔施泰因基尔', league: '德甲', abbr: 'FCH', aliases: ['基尔', '荷尔施泰因', 'Holstein Kiel'] },
  { name: '圣保利', league: '德甲', abbr: 'DAR', aliases: ['圣保利队', 'St. Pauli'] },

  // ----------------------------------------------------------
  //  德乙 2. Bundesliga (18 teams)
  // ----------------------------------------------------------
  { name: '科隆', league: '德乙', abbr: 'KOL', aliases: ['科隆队', '科隆FC', 'FC Koln'] },
  { name: '达姆施塔特', league: '德乙', abbr: 'DAR', aliases: ['达姆施塔特队', 'Darmstadt'] },
  { name: '汉堡', league: '德乙', abbr: 'HSV', aliases: ['汉堡队', '汉堡SV', 'HSV Hamburg'] },
  { name: '汉诺威96', league: '德乙', abbr: 'H96', aliases: ['汉诺威', '汉诺威队', 'Hannover'] },
  { name: '杜塞尔多夫', league: '德乙', abbr: 'DUS', aliases: ['杜塞尔多夫队', '杜塞', 'Fortuna Dusseldorf'] },
  { name: '帕德博恩', league: '德乙', abbr: 'PAD', aliases: ['帕德博恩队', 'Paderborn'] },
  { name: '纽伦堡', league: '德乙', abbr: 'NUR', aliases: ['纽伦堡队', 'Nurnberg'] },
  { name: '柏林赫塔', league: '德乙', abbr: 'BSC', aliases: ['赫塔', '柏林赫塔队', 'Hertha Berlin'] },
  { name: '卡尔斯鲁厄', league: '德乙', abbr: 'KSC', aliases: ['卡尔斯鲁厄队', 'Karlsruhe'] },
  { name: '马格德堡', league: '德乙', abbr: 'MAG', aliases: ['马格德堡队', 'Magdeburg'] },
  { name: '沙尔克04', league: '德乙', abbr: 'S04', aliases: ['沙尔克', '皇家蓝', 'Schalke'] },
  { name: '布伦瑞克', league: '德乙', abbr: 'EBS', aliases: ['布伦瑞克队', 'Braunschweig'] },
  { name: '格罗伊特菲尔特', league: '德乙', abbr: 'GRF', aliases: ['菲尔特', 'Greuther Furth'] },
  { name: '厄尔格博格', league: '德乙', abbr: 'AUE', aliases: ['奥厄', '厄尔格博格队', 'Erzgebirge Aue'] },
  { name: '埃尔弗斯堡', league: '德乙', abbr: 'ELV', aliases: ['埃尔弗斯堡队', 'Elversberg'] },
  { name: '乌尔姆', league: '德乙', abbr: 'ULM', aliases: ['乌尔姆队', 'SSV Ulm'] },
  { name: '普鲁士明斯特', league: '德乙', abbr: 'SCP', aliases: ['明斯特', 'Preussen Munster'] },
  { name: '雷根斯堡', league: '德乙', abbr: 'SSV', aliases: ['雷根斯堡队', 'Jahn Regensburg'] },

  // ----------------------------------------------------------
  //  法甲 Ligue 1 (18 teams)
  // ----------------------------------------------------------
  { name: '巴黎圣日耳曼', league: '法甲', abbr: 'PSG', aliases: ['巴黎', 'PSG', '大巴黎', '巴黎队', 'Paris Saint-Germain'] },
  { name: '里昂', league: '法甲', abbr: 'OL', aliases: ['里昂队', '奥林匹克里昂', 'Lyon'] },
  { name: '马赛', league: '法甲', abbr: 'OM', aliases: ['马赛队', '奥林匹克马赛', 'Marseille'] },
  { name: '摩纳哥', league: '法甲', abbr: 'ASM', aliases: ['摩纳哥队', 'Monaco'] },
  { name: '里尔', league: '法甲', abbr: 'LIL', aliases: ['里尔队', 'Lille'] },
  { name: '雷恩', league: '法甲', abbr: 'REN', aliases: ['雷恩队', 'Rennes'] },
  { name: '朗斯', league: '法甲', abbr: 'RCL', aliases: ['朗斯队', 'Lens'] },
  { name: '尼斯', league: '法甲', abbr: 'NIC', aliases: ['尼斯队', 'Nice'] },
  { name: '斯特拉斯堡', league: '法甲', abbr: 'STR', aliases: ['斯特拉斯堡队', 'Strasbourg'] },
  { name: '南特', league: '法甲', abbr: 'NAN', aliases: ['南特队', 'Nantes'] },
  { name: '图卢兹', league: '法甲', abbr: 'TFC', aliases: ['图卢兹队', 'Toulouse'] },
  { name: '欧塞尔', league: '法甲', abbr: 'AUX', aliases: ['欧塞尔队', 'Auxerre'] },
  { name: '圣埃蒂安', league: '法甲', abbr: 'STE', aliases: ['圣埃蒂安队', 'Saint-Etienne'] },
  { name: '勒阿弗尔', league: '法甲', abbr: 'HAC', aliases: ['勒阿弗尔队', 'Le Havre'] },
  { name: '蒙彼利埃', league: '法甲', abbr: 'MON', aliases: ['蒙彼利埃队', 'Montpellier'] },
  { name: '布雷斯特', league: '法甲', abbr: 'BRE', aliases: ['布雷斯特队', 'Brest'] },
  { name: '昂热', league: '法甲', abbr: 'ANG', aliases: ['昂热队', 'Angers'] },
  { name: '兰斯', league: '法甲', abbr: 'REI', aliases: ['兰斯队', 'Reims'] },

  // ----------------------------------------------------------
  //  法乙 Ligue 2 (20 teams)
  // ----------------------------------------------------------
  { name: '梅斯', league: '法乙', abbr: 'MET', aliases: ['梅斯队', 'Metz'] },
  { name: '洛里昂', league: '法乙', abbr: 'LOR', aliases: ['洛里昂队', 'Lorient'] },
  { name: '克莱蒙', league: '法乙', abbr: 'CLE', aliases: ['克莱蒙费朗', '克莱蒙队', 'Clermont'] },
  { name: '卡昂', league: '法乙', abbr: 'CAE', aliases: ['卡昂队', 'Caen'] },
  { name: '巴黎FC', league: '法乙', abbr: 'PFC', aliases: ['巴黎FC队', 'Paris FC'] },
  { name: '阿雅克肖', league: '法乙', abbr: 'AJA', aliases: ['阿雅克肖队', 'Ajaccio'] },
  { name: '甘冈', league: '法乙', abbr: 'GIN', aliases: ['甘冈队', 'Guingamp'] },
  { name: '亚眠', league: '法乙', abbr: 'AMI', aliases: ['亚眠队', 'Amiens'] },
  { name: '特鲁瓦', league: '法乙', abbr: 'TRO', aliases: ['特鲁瓦队', 'Troyes'] },
  { name: '格勒诺布尔', league: '法乙', abbr: 'GRE', aliases: ['格勒诺布尔队', 'Grenoble'] },
  { name: '波尔多', league: '法乙', abbr: 'BOR', aliases: ['波尔多队', 'Bordeaux'] },
  { name: '罗德兹', league: '法乙', abbr: 'ROD', aliases: ['罗德兹队', 'Rodez'] },
  { name: '瓦朗谢纳', league: '法乙', abbr: 'VAL', aliases: ['瓦朗谢纳队', 'Valenciennes'] },
  { name: '拉瓦勒', league: '法乙', abbr: 'LAV', aliases: ['拉瓦勒队', 'Laval'] },
  { name: '巴斯蒂亚', league: '法乙', abbr: 'BAS', aliases: ['巴斯蒂亚队', 'Bastia'] },
  { name: '敦刻尔克', league: '法乙', abbr: 'DUN', aliases: ['敦刻尔克队', 'Dunkerque'] },
  { name: '红星', league: '法乙', abbr: 'RED', aliases: ['红星队', 'Red Star'] },
  { name: '马蒂格', league: '法乙', abbr: 'MAR', aliases: ['马蒂格队', 'Martigues'] },
  { name: '昂热SCO', league: '法乙', abbr: 'ANG', aliases: ['昂热B', 'Angers B'] },
  { name: '索肖', league: '法乙', abbr: 'SOC', aliases: ['索肖队', 'Sochaux'] },

  // ----------------------------------------------------------
  //  荷甲 Eredivisie (18 teams)
  // ----------------------------------------------------------
  { name: '阿贾克斯', league: '荷甲', abbr: 'AJA', aliases: ['阿贾克斯队', 'Ajax'] },
  { name: '埃因霍温', league: '荷甲', abbr: 'PSV', aliases: ['PSV', 'PSV埃因霍温', '埃因霍温队', 'PSV Eindhoven'] },
  { name: '费耶诺德', league: '荷甲', abbr: 'FEY', aliases: ['费耶诺德队', 'Feyenoord'] },
  { name: '阿尔克马尔', league: '荷甲', abbr: 'AZ', aliases: ['AZ', 'AZ阿尔克马尔', 'AZ Alkmaar'] },
  { name: '特温特', league: '荷甲', abbr: 'TWE', aliases: ['特温特队', 'Twente'] },
  { name: '乌得勒支', league: '荷甲', abbr: 'UTR', aliases: ['乌得勒支队', 'FC Utrecht'] },
  { name: '海伦芬', league: '荷甲', abbr: 'HEE', aliases: ['海伦芬队', 'Heerenveen'] },
  { name: '维特斯', league: '荷甲', abbr: 'VIT', aliases: ['维特斯队', 'Vitesse'] },
  { name: '兹沃勒', league: '荷甲', abbr: 'ZWO', aliases: ['兹沃勒队', 'PEC Zwolle'] },
  { name: '格罗宁根', league: '荷甲', abbr: 'GRO', aliases: ['格罗宁根队', 'Groningen'] },
  { name: '奈梅亨', league: '荷甲', abbr: 'NEC', aliases: ['NEC奈梅亨', '奈梅亨队', 'NEC Nijmegen'] },
  { name: '福图纳锡塔德', league: '荷甲', abbr: 'FOR', aliases: ['锡塔德', '福图纳', 'Fortuna Sittard'] },
  { name: '布雷达', league: '荷甲', abbr: 'NAC', aliases: ['NAC布雷达', 'NAC Breda'] },
  { name: '瓦尔韦克', league: '荷甲', abbr: 'RKC', aliases: ['RKC瓦尔韦克', 'RKC Waalwijk'] },
  { name: '斯巴达鹿特丹', league: '荷甲', abbr: 'SPA', aliases: ['斯巴达', '鹿特丹', 'Sparta Rotterdam'] },
  { name: '赫拉克勒斯', league: '荷甲', abbr: 'HER', aliases: ['赫拉克勒斯队', 'Heracles'] },
  { name: '阿尔梅勒城', league: '荷甲', abbr: 'ALM', aliases: ['阿尔梅勒', 'Almere City'] },
  { name: '威廉二世', league: '荷甲', abbr: 'WIL', aliases: ['威廉二世队', 'Willem II'] },

  // ----------------------------------------------------------
  //  葡超 Primeira Liga (18 teams)
  // ----------------------------------------------------------
  { name: '本菲卡', league: '葡超', abbr: 'BEN', aliases: ['本菲卡队', '老鹰', 'Benfica'] },
  { name: '波尔图', league: '葡超', abbr: 'POR', aliases: ['波尔图队', '波尔图FC', 'FC Porto'] },
  { name: '葡萄牙体育', league: '葡超', abbr: 'SCP', aliases: ['里斯本竞技', '体育', '葡体', 'Sporting CP'] },
  { name: '布拉加', league: '葡超', abbr: 'BRA', aliases: ['布拉加队', '布拉加体育', 'SC Braga'] },
  { name: '吉马良斯', league: '葡超', abbr: 'VIT', aliases: ['吉马良斯队', '维多利亚', 'Vitoria Guimaraes'] },
  { name: '法马利康', league: '葡超', abbr: 'FAM', aliases: ['法马利康队', 'Famalicao'] },
  { name: '里奥阿维', league: '葡超', abbr: 'RIO', aliases: ['里奥阿维队', 'Rio Ave'] },
  { name: '博阿维斯塔', league: '葡超', abbr: 'BOA', aliases: ['博阿维斯塔队', 'Boavista'] },
  { name: '吉尔维森特', league: '葡超', abbr: 'GIL', aliases: ['吉尔维森特队', 'Gil Vicente'] },
  { name: '马里迪莫', league: '葡超', abbr: 'MAR', aliases: ['马里迪莫队', 'Maritimo'] },
  { name: '阿罗卡', league: '葡超', abbr: 'ARO', aliases: ['阿罗卡队', 'Arouca'] },
  { name: '卡萨皮亚', league: '葡超', abbr: 'CAS', aliases: ['卡萨皮亚队', 'Casa Pia'] },
  { name: '莫雷伦斯', league: '葡超', abbr: 'MOR', aliases: ['莫雷伦斯队', 'Moreirense'] },
  { name: '埃斯托里尔', league: '葡超', abbr: 'EST', aliases: ['埃斯托里尔队', 'Estoril'] },
  { name: '维塞乌', league: '葡超', abbr: 'ACA', aliases: ['维塞乌队', 'Academica Viseu'] },
  { name: '阿维斯', league: '葡超', abbr: 'AVE', aliases: ['阿维斯队', 'Aves'] },
  { name: '星队', league: '葡超', abbr: 'EST', aliases: ['星队', 'Estrela Amadora'] },
  { name: '国民队', league: '葡超', abbr: 'NAC', aliases: ['国民', 'Nacional'] },

  // ----------------------------------------------------------
  //  土超 Süper Lig (19 teams)
  // ----------------------------------------------------------
  { name: '加拉塔萨雷', league: '土超', abbr: 'GAL', aliases: ['加拉塔', '加拉塔萨雷队', 'Galatasaray'] },
  { name: '费内巴切', league: '土超', abbr: 'FEN', aliases: ['费内巴切队', 'Fenerbahce'] },
  { name: '贝西克塔斯', league: '土超', abbr: 'BES', aliases: ['贝西克塔斯队', '黑鹰', 'Besiktas'] },
  { name: '特拉布宗', league: '土超', abbr: 'TRA', aliases: ['特拉布宗体育', '特拉布宗队', 'Trabzonspor'] },
  { name: '巴萨克谢希尔', league: '土超', abbr: 'IBB', aliases: ['巴萨克谢希尔队', 'Basaksehir'] },
  { name: '阿达纳', league: '土超', abbr: 'ADA', aliases: ['阿达纳德米尔', 'Adana Demirspor'] },
  { name: '开塞利', league: '土超', abbr: 'KAY', aliases: ['开塞利体育', 'Kayserispor'] },
  { name: '安塔利亚', league: '土超', abbr: 'ANT', aliases: ['安塔利亚体育', 'Antalyaspor'] },
  { name: '科尼亚', league: '土超', abbr: 'KON', aliases: ['科尼亚体育', 'Konyaspor'] },
  { name: '锡瓦斯', league: '土超', abbr: 'SIV', aliases: ['锡瓦斯体育', 'Sivasspor'] },
  { name: '加济安泰普', league: '土超', abbr: 'GAZ', aliases: ['加济安泰普队', 'Gaziantep'] },
  { name: '阿兰亚', league: '土超', abbr: 'ALA', aliases: ['阿兰亚体育', 'Alanyaspor'] },
  { name: '里泽', league: '土超', abbr: 'RIZ', aliases: ['里泽体育', 'Rizespor'] },
  { name: '哈塔伊', league: '土超', abbr: 'HAT', aliases: ['哈塔伊体育', 'Hatayspor'] },
  { name: '彭迪克', league: '土超', abbr: 'PEN', aliases: ['彭迪克体育', 'Pendikspor'] },
  { name: '伊斯坦布尔', league: '土超', abbr: 'IST', aliases: ['伊斯坦布尔体育', 'Istanbulspor'] },
  { name: '卡斯帕萨', league: '土超', abbr: 'KAS', aliases: ['卡斯帕萨队', 'Kasimpasa'] },
  { name: '萨姆松', league: '土超', abbr: 'SAM', aliases: ['萨姆松体育', 'Samsunspor'] },
  { name: '博德鲁姆', league: '土超', abbr: 'BOD', aliases: ['博德鲁姆体育', 'Bodrumspor'] },

  // ----------------------------------------------------------
  //  比甲 Belgian Pro League (top 16)
  // ----------------------------------------------------------
  { name: '布鲁日', league: '比甲', abbr: 'CLB', aliases: ['布鲁日队', '布鲁日俱乐部', 'Club Brugge'] },
  { name: '安德莱赫特', league: '比甲', abbr: 'AND', aliases: ['安德莱赫特队', 'Anderlecht'] },
  { name: '根特', league: '比甲', abbr: 'GEN', aliases: ['根特队', 'KAA Gent'] },
  { name: '安特卫普', league: '比甲', abbr: 'ANT', aliases: ['安特卫普队', 'Royal Antwerp'] },
  { name: '标准列日', league: '比甲', abbr: 'STL', aliases: ['列日', '标准列日队', 'Standard Liege'] },
  { name: '亨克', league: '比甲', abbr: 'GNK', aliases: ['亨克队', 'Racing Genk'] },
  { name: '圣吉尔联合', league: '比甲', abbr: 'USG', aliases: ['圣吉尔', 'Union SG'] },
  { name: '梅赫伦', league: '比甲', abbr: 'MEC', aliases: ['梅赫伦队', 'Mechelen'] },
  { name: '色格拉布鲁日', league: '比甲', abbr: 'CER', aliases: ['色格拉', 'Cercle Brugge'] },
  { name: '奥斯坦德', league: '比甲', abbr: 'OST', aliases: ['奥斯坦德队', 'Oostende'] },
  { name: '科特赖克', league: '比甲', abbr: 'KVK', aliases: ['科特赖克队', 'Kortrijk'] },
  { name: '沙勒罗瓦', league: '比甲', abbr: 'CHA', aliases: ['沙勒罗瓦队', 'Charleroi'] },
  { name: '韦斯特洛', league: '比甲', abbr: 'WES', aliases: ['韦斯特洛队', 'Westerlo'] },
  { name: '欧本', league: '比甲', abbr: 'EUP', aliases: ['欧本队', 'Eupen'] },
  { name: '鲁汶', league: '比甲', abbr: 'OHL', aliases: ['鲁汶队', 'OH Leuven'] },
  { name: '贝弗伦', league: '比甲', abbr: 'BEV', aliases: ['贝弗伦队', 'Beveren'] },

  // ----------------------------------------------------------
  //  苏超 Scottish Premiership (12 teams - top 6-8 notable)
  // ----------------------------------------------------------
  { name: '凯尔特人', league: '苏超', abbr: 'CEL', aliases: ['凯尔特人队', '格拉斯哥凯尔特人', 'Celtic'] },
  { name: '流浪者', league: '苏超', abbr: 'RAN', aliases: ['格拉斯哥流浪者', '流浪者队', 'Rangers'] },
  { name: '阿伯丁', league: '苏超', abbr: 'ABE', aliases: ['阿伯丁队', 'Aberdeen'] },
  { name: '哈茨', league: '苏超', abbr: 'HEA', aliases: ['哈茨队', '心脏队', 'Hearts'] },
  { name: '希伯尼安', league: '苏超', abbr: 'HIB', aliases: ['希伯尼安队', 'Hibernian'] },
  { name: '邓迪联', league: '苏超', abbr: 'DUN', aliases: ['邓迪联队', 'Dundee United'] },
  { name: '马瑟韦尔', league: '苏超', abbr: 'MOT', aliases: ['马瑟韦尔队', 'Motherwell'] },
  { name: '基尔马诺克', league: '苏超', abbr: 'KIL', aliases: ['基尔马诺克队', 'Kilmarnock'] },

  // ----------------------------------------------------------
  //  奥甲 Austrian Bundesliga (12 teams - top 6-8 notable)
  // ----------------------------------------------------------
  { name: '萨尔茨堡红牛', league: '奥甲', abbr: 'RBS', aliases: ['萨尔茨堡', '红牛萨尔茨堡', 'RB Salzburg'] },
  { name: '格拉茨风暴', league: '奥甲', abbr: 'STU', aliases: ['格拉茨', '风暴格拉茨', 'Sturm Graz'] },
  { name: '维也纳快速', league: '奥甲', abbr: 'RAP', aliases: ['快速', '维也纳快速队', 'Rapid Wien'] },
  { name: '奥地利维也纳', league: '奥甲', abbr: 'AUS', aliases: ['维也纳', '奥地利维也纳队', 'Austria Wien'] },
  { name: '林茨', league: '奥甲', abbr: 'LAS', aliases: ['林茨队', 'LASK Linz'] },
  { name: '沃尔夫斯贝格', league: '奥甲', abbr: 'WAC', aliases: ['沃尔夫斯贝格队', 'Wolfsberger'] },
  { name: '哈特贝格', league: '奥甲', abbr: 'HAR', aliases: ['哈特贝格队', 'Hartberg'] },
  { name: '克拉根福', league: '奥甲', abbr: 'KLA', aliases: ['克拉根福队', 'Austria Klagenfurt'] },

  // ----------------------------------------------------------
  //  瑞超 Swiss Super League (12 teams - top 6-8 notable)
  // ----------------------------------------------------------
  { name: '伯尔尼年轻人', league: '瑞超', abbr: 'YB', aliases: ['年轻人', 'BSC年轻人', 'Young Boys'] },
  { name: '巴塞尔', league: '瑞超', abbr: 'BAS', aliases: ['巴塞尔队', 'FC Basel'] },
  { name: '苏黎世', league: '瑞超', abbr: 'FCZ', aliases: ['苏黎世队', 'FC Zurich'] },
  { name: '卢塞恩', league: '瑞超', abbr: 'LUZ', aliases: ['卢塞恩队', 'Luzern'] },
  { name: '塞尔维特', league: '瑞超', abbr: 'SER', aliases: ['塞尔维特队', 'Servette'] },
  { name: '圣加仑', league: '瑞超', abbr: 'STG', aliases: ['圣加仑队', 'St. Gallen'] },
  { name: '草蜢', league: '瑞超', abbr: 'GCZ', aliases: ['草蜢队', 'Grasshoppers'] },
  { name: '锡昂', league: '瑞超', abbr: 'SIO', aliases: ['锡昂队', 'FC Sion'] },

  // ----------------------------------------------------------
  //  希超 Greek Super League (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '奥林匹亚科斯', league: '希超', abbr: 'OLY', aliases: ['奥林匹亚科斯队', 'Olympiacos'] },
  { name: '帕纳辛奈科斯', league: '希超', abbr: 'PAO', aliases: ['帕纳辛奈科斯队', 'Panathinaikos'] },
  { name: 'PAOK', league: '希超', abbr: 'PAK', aliases: ['塞萨洛尼基', 'PAOK Thessaloniki'] },
  { name: 'AEK雅典', league: '希超', abbr: 'AEK', aliases: ['雅典AEK', 'AEK Athens'] },
  { name: '阿里斯', league: '希超', abbr: 'ARI', aliases: ['阿里斯队', '阿里斯萨洛尼卡', 'Aris'] },
  { name: '沃洛斯', league: '希超', abbr: 'VOL', aliases: ['沃洛斯队', 'Volos'] },

  // ----------------------------------------------------------
  //  捷甲 Czech First League (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '布拉格斯巴达', league: '捷甲', abbr: 'SPA', aliases: ['斯巴达', '布拉格斯巴达队', 'Sparta Prague'] },
  { name: '布拉格斯拉维亚', league: '捷甲', abbr: 'SLA', aliases: ['斯拉维亚', '布拉格斯拉维亚队', 'Slavia Prague'] },
  { name: '比尔森胜利', league: '捷甲', abbr: 'PLZ', aliases: ['比尔森', '维多利亚比尔森', 'Viktoria Plzen'] },
  { name: '布拉格博莱斯拉夫', league: '捷甲', abbr: 'MBL', aliases: ['博莱斯拉夫', 'Mlada Boleslav'] },
  { name: '利贝雷茨', league: '捷甲', abbr: 'LIB', aliases: ['利贝雷茨队', 'Liberec'] },
  { name: '奥洛穆茨', league: '捷甲', abbr: 'SIG', aliases: ['奥洛穆茨队', 'Sigma Olomouc'] },
  { name: '俄斯特拉发', league: '捷甲', abbr: 'BAO', aliases: ['俄斯特拉发队', 'Banik Ostrava'] },

  // ----------------------------------------------------------
  //  克甲 Croatian First Football League (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '萨格勒布迪纳摩', league: '克甲', abbr: 'DIN', aliases: ['迪纳摩', '萨格勒布', 'Dinamo Zagreb'] },
  { name: '海杜克', league: '克甲', abbr: 'HAJ', aliases: ['海杜克队', '海杜克斯普利特', 'Hajduk Split'] },
  { name: '奥西耶克', league: '克甲', abbr: 'OSI', aliases: ['奥西耶克队', 'Osijek'] },
  { name: '里耶卡', league: '克甲', abbr: 'RIJ', aliases: ['里耶卡队', 'Rijeka'] },
  { name: '戈里察', league: '克甲', abbr: 'GOR', aliases: ['戈里察队', 'Gorica'] },
  { name: '伊斯特拉', league: '克甲', abbr: 'IST', aliases: ['伊斯特拉队', 'Istra 1961'] },

  // ----------------------------------------------------------
  //  塞超 Serbian SuperLiga (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '贝尔格莱德红星', league: '塞超', abbr: 'CZV', aliases: ['红星', '贝红星', 'Red Star Belgrade'] },
  { name: '游击队', league: '塞超', abbr: 'PAR', aliases: ['贝尔格莱德游击队', '游击', 'Partizan Belgrade'] },
  { name: '沃伊沃迪纳', league: '塞超', abbr: 'VOJ', aliases: ['沃伊沃迪纳队', 'Vojvodina'] },
  { name: '茨维塔', league: '塞超', abbr: 'CUK', aliases: ['茨维塔队', 'Cukaricki'] },
  { name: '尼什工人', league: '塞超', abbr: 'RAD', aliases: ['尼什', '工人队', 'Radnicki Nis'] },
  { name: 'TSC', league: '塞超', abbr: 'TSC', aliases: ['巴奇卡托波拉', 'TSC Backa Topola'] },

  // ----------------------------------------------------------
  //  丹超 Danish Superliga (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '哥本哈根', league: '丹超', abbr: 'FCK', aliases: ['哥本哈根队', 'FC Copenhagen'] },
  { name: '米迪兰特', league: '丹超', abbr: 'FCM', aliases: ['中日德兰', '米迪兰特队', 'FC Midtjylland'] },
  { name: '北西兰', league: '丹超', abbr: 'NOR', aliases: ['北西兰队', 'FC Nordsjaelland'] },
  { name: '布隆德比', league: '丹超', abbr: 'BRO', aliases: ['布隆德比队', 'Brondby'] },
  { name: '奥尔胡斯', league: '丹超', abbr: 'AGF', aliases: ['奥胡斯', '奥尔胡斯队', 'AGF Aarhus'] },
  { name: '欧登塞', league: '丹超', abbr: 'OB', aliases: ['欧登塞队', 'OB Odense'] },
  { name: '锡尔克堡', league: '丹超', abbr: 'SIL', aliases: ['锡尔克堡队', 'Silkeborg'] },

  // ----------------------------------------------------------
  //  瑞典超 Allsvenskan (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '马尔默', league: '瑞典超', abbr: 'MFF', aliases: ['马尔默队', 'Malmo FF'] },
  { name: '佐加顿斯', league: '瑞典超', abbr: 'DIF', aliases: ['佐加顿斯队', 'Djurgardens'] },
  { name: 'AIK', league: '瑞典超', abbr: 'AIK', aliases: ['AIK索尔纳', 'AIK Solna'] },
  { name: '哈马比', league: '瑞典超', abbr: 'HAM', aliases: ['哈马比队', 'Hammarby'] },
  { name: '哥德堡', league: '瑞典超', abbr: 'IFK', aliases: ['哥德堡队', 'IFK Goteborg'] },
  { name: '北雪平', league: '瑞典超', abbr: 'NOR', aliases: ['北雪平队', 'IFK Norrkoping'] },
  { name: '埃尔夫斯堡', league: '瑞典超', abbr: 'ELF', aliases: ['埃尔夫斯堡队', 'IF Elfsborg'] },

  // ----------------------------------------------------------
  //  挪超 Eliteserien (top 6-8 notable)
  // ----------------------------------------------------------
  { name: '博德闪耀', league: '挪超', abbr: 'BOD', aliases: ['博德格林特', '博德', 'Bodo/Glimt'] },
  { name: '莫尔德', league: '挪超', abbr: 'MOL', aliases: ['莫尔德队', 'Molde'] },
  { name: '罗森博格', league: '挪超', abbr: 'RBK', aliases: ['罗森博格队', 'Rosenborg'] },
  { name: '瓦勒伦加', league: '挪超', abbr: 'VIF', aliases: ['瓦勒伦加队', 'Valerenga'] },
  { name: '维京', league: '挪超', abbr: 'VIK', aliases: ['维京队', 'Viking'] },
  { name: '布兰', league: '挪超', abbr: 'BRA', aliases: ['布兰队', 'SK Brann'] },
  { name: '利勒斯特罗姆', league: '挪超', abbr: 'LIL', aliases: ['利勒斯特罗姆队', 'Lillestrom'] },

  // ----------------------------------------------------------
  //  沙特联 Saudi Pro League (18 teams)
  // ----------------------------------------------------------
  { name: '利雅得新月', league: '沙特联', abbr: 'HIL', aliases: ['新月', '利雅得新月队', 'Al Hilal'] },
  { name: '利雅得胜利', league: '沙特联', abbr: 'NAS', aliases: ['胜利', '利雅得胜利队', 'Al Nassr'] },
  { name: '吉达联合', league: '沙特联', abbr: 'AHI', aliases: ['阿赫利', '吉达联合队', 'Al Ahli'] },
  { name: '吉达联', league: '沙特联', abbr: 'ITT', aliases: ['伊蒂哈德', '吉达联队', 'Al Ittihad'] },
  { name: '利雅得青年', league: '沙特联', abbr: 'SHA', aliases: ['阿尔沙巴布', '利雅得青年队', 'Al Shabab'] },
  { name: '塔亚文', league: '沙特联', abbr: 'TAA', aliases: ['塔亚文队', 'Al Taawoun'] },
  { name: '法特赫', league: '沙特联', abbr: 'FAT', aliases: ['法特赫队', 'Al Fateh'] },
  { name: '拉伊德', league: '沙特联', abbr: 'RAE', aliases: ['拉伊德队', 'Al Raed'] },
  { name: '达曼协作', league: '沙特联', abbr: 'ETT', aliases: ['达曼', '达曼协作队', 'Ettifaq'] },
  { name: '利雅得合作', league: '沙特联', abbr: 'FEI', aliases: ['费哈', '利雅得合作队', 'Al Feiha'] },
  { name: '哈泽姆', league: '沙特联', abbr: 'HAZ', aliases: ['哈泽姆队', 'Al Hazem'] },
  { name: '卡利杰', league: '沙特联', abbr: 'KHO', aliases: ['卡利杰队', '科利季', 'Al Khaleej'] },
  { name: '阿科多', league: '沙特联', abbr: 'AKH', aliases: ['阿科多队', 'Al Akhdoud'] },
  { name: '阿维赫达', league: '沙特联', abbr: 'WEH', aliases: ['阿维赫达队', 'Al Wehda'] },
  { name: '奥鲁巴', league: '沙特联', abbr: 'ORO', aliases: ['奥鲁巴队', 'Al Orubah'] },
  { name: '利雅得', league: '沙特联', abbr: 'RIY', aliases: ['利雅得队', 'Al Riyadh'] },
  { name: '卡迪西亚', league: '沙特联', abbr: 'QAD', aliases: ['卡迪西亚队', 'Al Qadisiyah'] },
  { name: '吉赞', league: '沙特联', abbr: 'JIZ', aliases: ['吉赞队', 'Jizzan'] },
  { name: '达马克', league: '沙特联', abbr: 'DMK', aliases: ['达马克队', 'Damac', 'Dhamk'] },

  // ----------------------------------------------------------
  //  中超 Chinese Super League (16 teams 2025-2026)
  // ----------------------------------------------------------
  { name: '上海海港', league: '中超', abbr: 'SHP', aliases: ['海港', '上港', '上海上港', 'Shanghai Port'] },
  { name: '山东泰山', league: '中超', abbr: 'SDT', aliases: ['泰山', '山东鲁能', '鲁能', 'Shandong Taishan'] },
  { name: '上海申花', league: '中超', abbr: 'SHE', aliases: ['申花', '上海申花队', 'Shanghai Shenhua'] },
  { name: '北京国安', league: '中超', abbr: 'BGA', aliases: ['国安', '北京国安队', '御林军', 'Beijing Guoan'] },
  { name: '成都蓉城', league: '中超', abbr: 'CDR', aliases: ['蓉城', '成都', 'Chengdu Rongcheng'] },
  { name: '武汉三镇', league: '中超', abbr: 'WHS', aliases: ['三镇', '武汉', 'Wuhan Three Towns'] },
  { name: '浙江队', league: '中超', abbr: 'ZHJ', aliases: ['浙江', '浙江绿城', '绿城', 'Zhejiang FC'] },
  { name: '天津津门虎', league: '中超', abbr: 'TJT', aliases: ['津门虎', '天津', '天津泰达', 'Tianjin Jinmen Tiger'] },
  { name: '长春亚泰', league: '中超', abbr: 'CYA', aliases: ['亚泰', '长春', 'Changchun Yatai'] },
  { name: '河南队', league: '中超', abbr: 'HEN', aliases: ['河南', '河南建业', '建业', 'Henan FC'] },
  { name: '大连人', league: '中超', abbr: 'DLR', aliases: ['大连', '大连人队', 'Dalian Pro'] },
  { name: '深圳新鹏城', league: '中超', abbr: 'SZN', aliases: ['深圳', '新鹏城', '鹏城', '深圳队', 'Shenzhen'] },
  { name: '沧州雄狮', league: '中超', abbr: 'CZX', aliases: ['沧州', '雄狮', 'Cangzhou Mighty Lions'] },
  { name: '南通支云', league: '中超', abbr: 'NTZ', aliases: ['南通', '支云', 'Nantong Zhiyun'] },
  { name: '梅州客家', league: '中超', abbr: 'MZK', aliases: ['梅州', '客家', 'Meizhou Hakka'] },
  { name: '青岛海牛', league: '中超', abbr: 'QDH', aliases: ['青岛', '海牛', '青岛队', 'Qingdao Hainiu'] },

  // ----------------------------------------------------------
  //  美职联 MLS (30 teams)
  // ----------------------------------------------------------
  { name: '迈阿密国际', league: '美职联', abbr: 'MIA', aliases: ['迈阿密', '国际迈阿密', 'Inter Miami'] },
  { name: '洛杉矶FC', league: '美职联', abbr: 'LAF', aliases: ['LAFC', '洛杉矶FC队', 'LAFC'] },
  { name: '洛杉矶银河', league: '美职联', abbr: 'LAG', aliases: ['银河', '洛杉矶银河队', 'LA Galaxy'] },
  { name: '纽约城', league: '美职联', abbr: 'NYC', aliases: ['纽约城队', '纽约城FC', 'New York City FC'] },
  { name: '纽约红牛', league: '美职联', abbr: 'NYR', aliases: ['纽约红牛队', 'New York Red Bulls'] },
  { name: '亚特兰大联', league: '美职联', abbr: 'ATL', aliases: ['亚特兰大联队', 'Atlanta United'] },
  { name: '西雅图海湾人', league: '美职联', abbr: 'SEA', aliases: ['西雅图', '海湾人', 'Seattle Sounders'] },
  { name: '波特兰伐木工', league: '美职联', abbr: 'POR', aliases: ['波特兰', '伐木工', 'Portland Timbers'] },
  { name: '辛辛那提', league: '美职联', abbr: 'CIN', aliases: ['辛辛那提FC', 'FC Cincinnati'] },
  { name: '纳什维尔', league: '美职联', abbr: 'NSH', aliases: ['纳什维尔SC', 'Nashville SC'] },
  { name: '哥伦布机员', league: '美职联', abbr: 'CLB', aliases: ['哥伦布', 'Columbus Crew'] },
  { name: '费城联合', league: '美职联', abbr: 'PHI', aliases: ['费城', '费城联合队', 'Philadelphia Union'] },
  { name: '多伦多FC', league: '美职联', abbr: 'TOR', aliases: ['多伦多', 'Toronto FC'] },
  { name: '蒙特利尔', league: '美职联', abbr: 'MTL', aliases: ['蒙特利尔队', 'CF Montreal'] },
  { name: '温哥华白浪', league: '美职联', abbr: 'VAN', aliases: ['温哥华', 'Vancouver Whitecaps'] },
  { name: '达拉斯FC', league: '美职联', abbr: 'DAL', aliases: ['达拉斯', 'FC Dallas'] },
  { name: '休斯顿发电机', league: '美职联', abbr: 'HOU', aliases: ['休斯顿', '发电机', 'Houston Dynamo'] },
  { name: '堪萨斯城竞技', league: '美职联', abbr: 'SKC', aliases: ['堪萨斯城', 'Sporting KC'] },
  { name: '明尼苏达联', league: '美职联', abbr: 'MIN', aliases: ['明尼苏达', 'Minnesota United'] },
  { name: '科罗拉多急流', league: '美职联', abbr: 'COL', aliases: ['科罗拉多', '急流', 'Colorado Rapids'] },
  { name: '奥斯汀FC', league: '美职联', abbr: 'ATX', aliases: ['奥斯汀', 'Austin FC'] },
  { name: '盐湖城', league: '美职联', abbr: 'RSL', aliases: ['盐湖城队', '皇家盐湖城', 'Real Salt Lake'] },
  { name: '圣何塞地震', league: '美职联', abbr: 'SJE', aliases: ['圣何塞', '地震', 'San Jose Earthquakes'] },
  { name: '新英格兰革命', league: '美职联', abbr: 'NE', aliases: ['新英格兰', '革命', 'New England Revolution'] },
  { name: '芝加哥火焰', league: '美职联', abbr: 'CHI', aliases: ['芝加哥', '火焰', 'Chicago Fire'] },
  { name: '夏洛特FC', league: '美职联', abbr: 'CLT', aliases: ['夏洛特', 'Charlotte FC'] },
  { name: '奥兰多城', league: '美职联', abbr: 'ORL', aliases: ['奥兰多', 'Orlando City'] },
  { name: 'DC联合', league: '美职联', abbr: 'DC', aliases: ['华盛顿联', 'DC United'] },
  { name: '圣路易斯城', league: '美职联', abbr: 'STL', aliases: ['圣路易斯', 'St. Louis City'] },
  { name: '圣迭戈FC', league: '美职联', abbr: 'SDG', aliases: ['圣迭戈', 'San Diego FC'] },

  // ----------------------------------------------------------
  //  日职 J1 League (20 teams)
  // ----------------------------------------------------------
  { name: '横滨水手', league: '日职', abbr: 'YFM', aliases: ['横滨F马里诺斯', '横滨', 'Yokohama F. Marinos'] },
  { name: '神户胜利船', league: '日职', abbr: 'VKO', aliases: ['神户', '胜利船', 'Vissel Kobe'] },
  { name: '川崎前锋', league: '日职', abbr: 'KAW', aliases: ['川崎', '前锋', 'Kawasaki Frontale'] },
  { name: '浦和红钻', league: '日职', abbr: 'URA', aliases: ['浦和', '红钻', 'Urawa Reds'] },
  { name: '鹿岛鹿角', league: '日职', abbr: 'KAS', aliases: ['鹿岛', '鹿角', 'Kashima Antlers'] },
  { name: '广岛三箭', league: '日职', abbr: 'HIR', aliases: ['广岛', '三箭', 'Sanfrecce Hiroshima'] },
  { name: '名古屋鲸八', league: '日职', abbr: 'NAG', aliases: ['名古屋', '鲸八', 'Nagoya Grampus'] },
  { name: 'FC东京', league: '日职', abbr: 'FCT', aliases: ['东京', 'FC东京队', 'FC Tokyo'] },
  { name: '大阪樱花', league: '日职', abbr: 'COS', aliases: ['大阪', '樱花', 'Cerezo Osaka'] },
  { name: '大阪飞脚', league: '日职', abbr: 'GAM', aliases: ['飞脚', '钢巴大阪', 'Gamba Osaka'] },
  { name: '札幌冈萨多', league: '日职', abbr: 'CON', aliases: ['札幌', 'Consadole Sapporo'] },
  { name: '新潟天鹅', league: '日职', abbr: 'ALB', aliases: ['新潟', '天鹅', 'Albirex Niigata'] },
  { name: '柏太阳神', league: '日职', abbr: 'KRE', aliases: ['柏', '太阳神', 'Kashiwa Reysol'] },
  { name: '湘南比马', league: '日职', abbr: 'SHO', aliases: ['湘南', 'Shonan Bellmare'] },
  { name: '町田泽维亚', league: '日职', abbr: 'MAC', aliases: ['町田', 'Machida Zelvia'] },
  { name: '磐田喜悦', league: '日职', abbr: 'JUB', aliases: ['磐田', 'Jubilo Iwata'] },
  { name: '东京绿茵', league: '日职', abbr: 'TOK', aliases: ['东京日尔迪', 'Tokyo Verdy'] },
  { name: '京都不死鸟', league: '日职', abbr: 'KYO', aliases: ['京都', '不死鸟', 'Kyoto Sanga'] },
  { name: '福冈黄蜂', league: '日职', abbr: 'AVI', aliases: ['福冈', 'Avispa Fukuoka'] },
  { name: '清水心跳', league: '日职', abbr: 'SHI', aliases: ['清水', '心跳', 'Shimizu S-Pulse'] },

  // ----------------------------------------------------------
  //  韩K K League 1 (12 teams)
  // ----------------------------------------------------------
  { name: '蔚山现代', league: '韩K', abbr: 'ULS', aliases: ['蔚山', '现代', 'Ulsan HD'] },
  { name: '全北现代', league: '韩K', abbr: 'JBM', aliases: ['全北', '全北汽车', 'Jeonbuk Motors'] },
  { name: '浦项制铁', league: '韩K', abbr: 'POH', aliases: ['浦项', '制铁', 'Pohang Steelers'] },
  { name: '首尔FC', league: '韩K', abbr: 'SEO', aliases: ['首尔', 'FC Seoul'] },
  { name: '水原三星', league: '韩K', abbr: 'SUW', aliases: ['水原', '三星蓝翼', 'Suwon Bluewings'] },
  { name: '济州联', league: '韩K', abbr: 'JEJ', aliases: ['济州', '济州联队', 'Jeju United'] },
  { name: '仁川联', league: '韩K', abbr: 'INC', aliases: ['仁川', '仁川联队', 'Incheon United'] },
  { name: '大邱FC', league: '韩K', abbr: 'DAE', aliases: ['大邱', 'Daegu FC'] },
  { name: '大田市民', league: '韩K', abbr: 'DAJ', aliases: ['大田', '大田公民', 'Daejeon Citizen'] },
  { name: '光州FC', league: '韩K', abbr: 'GWA', aliases: ['光州', 'Gwangju FC'] },
  { name: '江原FC', league: '韩K', abbr: 'GAN', aliases: ['江原', 'Gangwon FC'] },
  { name: '金泉尚武', league: '韩K', abbr: 'GIM', aliases: ['尚武', '金泉', 'Gimcheon Sangmu'] },

  // ----------------------------------------------------------
  //  澳超 A-League (13 teams)
  // ----------------------------------------------------------
  { name: '墨尔本城', league: '澳超', abbr: 'MCY', aliases: ['墨城', '墨尔本城队', 'Melbourne City'] },
  { name: '墨尔本胜利', league: '澳超', abbr: 'MVC', aliases: ['墨胜', '墨尔本胜利队', 'Melbourne Victory'] },
  { name: '悉尼FC', league: '澳超', abbr: 'SYD', aliases: ['悉尼', 'Sydney FC'] },
  { name: '西悉尼流浪者', league: '澳超', abbr: 'WSW', aliases: ['西悉尼', 'Western Sydney Wanderers'] },
  { name: '中岸水手', league: '澳超', abbr: 'CCM', aliases: ['中岸', '水手', 'Central Coast Mariners'] },
  { name: '惠灵顿凤凰', league: '澳超', abbr: 'WPH', aliases: ['惠灵顿', '凤凰', 'Wellington Phoenix'] },
  { name: '布里斯班狮吼', league: '澳超', abbr: 'BRI', aliases: ['布里斯班', '狮吼', 'Brisbane Roar'] },
  { name: '珀斯光荣', league: '澳超', abbr: 'PER', aliases: ['珀斯', '光荣', 'Perth Glory'] },
  { name: '阿德莱德联', league: '澳超', abbr: 'ADL', aliases: ['阿德莱德', 'Adelaide United'] },
  { name: '纽卡斯尔喷射机', league: '澳超', abbr: 'NEW', aliases: ['纽卡喷射机', 'Newcastle Jets'] },
  { name: '西联', league: '澳超', abbr: 'WUN', aliases: ['西联队', '西部联', 'Western United'] },
  { name: '麦克阿瑟', league: '澳超', abbr: 'MAC', aliases: ['麦克阿瑟FC', 'Macarthur FC'] },
  { name: '奥克兰FC', league: '澳超', abbr: 'AUK', aliases: ['奥克兰', 'Auckland FC'] },

  // ----------------------------------------------------------
  //  国际赛 International (FIFA top ~100 + notable nations)
  // ----------------------------------------------------------
  // South America
  { name: '巴西', league: '国际赛', abbr: 'BRA', aliases: ['巴西队', '桑巴军团', '五星巴西'] },
  { name: '阿根廷', league: '国际赛', abbr: 'ARG', aliases: ['阿根廷队', '潘帕斯雄鹰'] },
  { name: '乌拉圭', league: '国际赛', abbr: 'URU', aliases: ['乌拉圭队'] },
  { name: '哥伦比亚', league: '国际赛', abbr: 'COL', aliases: ['哥伦比亚队'] },
  { name: '智利', league: '国际赛', abbr: 'CHI', aliases: ['智利队'] },
  { name: '厄瓜多尔', league: '国际赛', abbr: 'ECU', aliases: ['厄瓜多尔队'] },
  { name: '巴拉圭', league: '国际赛', abbr: 'PAR', aliases: ['巴拉圭队'] },
  { name: '秘鲁', league: '国际赛', abbr: 'PER', aliases: ['秘鲁队'] },
  { name: '玻利维亚', league: '国际赛', abbr: 'BOL', aliases: ['玻利维亚队'] },
  { name: '委内瑞拉', league: '国际赛', abbr: 'VEN', aliases: ['委内瑞拉队'] },

  // Europe - Western
  { name: '法国', league: '国际赛', abbr: 'FRA', aliases: ['法国队', '高卢雄鸡'] },
  { name: '英格兰', league: '国际赛', abbr: 'ENG', aliases: ['英格兰队', '三狮军团'] },
  { name: '西班牙', league: '国际赛', abbr: 'ESP', aliases: ['西班牙队', '斗牛士军团'] },
  { name: '德国', league: '国际赛', abbr: 'GER', aliases: ['德国队', '日耳曼战车'] },
  { name: '意大利', league: '国际赛', abbr: 'ITA', aliases: ['意大利队', '蓝衣军团'] },
  { name: '葡萄牙', league: '国际赛', abbr: 'POR', aliases: ['葡萄牙队'] },
  { name: '荷兰', league: '国际赛', abbr: 'NED', aliases: ['荷兰队', '橙衣军团'] },
  { name: '比利时', league: '国际赛', abbr: 'BEL', aliases: ['比利时队', '红魔', '欧洲红魔'] },
  { name: '瑞士', league: '国际赛', abbr: 'SUI', aliases: ['瑞士队'] },
  { name: '奥地利', league: '国际赛', abbr: 'AUT', aliases: ['奥地利队'] },
  { name: '苏格兰', league: '国际赛', abbr: 'SCO', aliases: ['苏格兰队'] },
  { name: '威尔士', league: '国际赛', abbr: 'WAL', aliases: ['威尔士队'] },
  { name: '爱尔兰', league: '国际赛', abbr: 'IRL', aliases: ['爱尔兰队'] },
  { name: '北爱尔兰', league: '国际赛', abbr: 'NIR', aliases: ['北爱尔兰队'] },

  // Europe - Scandinavia
  { name: '丹麦', league: '国际赛', abbr: 'DEN', aliases: ['丹麦队', '丹麦童话'] },
  { name: '瑞典', league: '国际赛', abbr: 'SWE', aliases: ['瑞典队'] },
  { name: '挪威', league: '国际赛', abbr: 'NOR', aliases: ['挪威队'] },
  { name: '芬兰', league: '国际赛', abbr: 'FIN', aliases: ['芬兰队'] },
  { name: '冰岛', league: '国际赛', abbr: 'ISL', aliases: ['冰岛队'] },

  // Europe - Central & Eastern
  { name: '克罗地亚', league: '国际赛', abbr: 'CRO', aliases: ['克罗地亚队', '格子军团'] },
  { name: '塞尔维亚', league: '国际赛', abbr: 'SRB', aliases: ['塞尔维亚队'] },
  { name: '波兰', league: '国际赛', abbr: 'POL', aliases: ['波兰队'] },
  { name: '捷克', league: '国际赛', abbr: 'CZE', aliases: ['捷克队'] },
  { name: '乌克兰', league: '国际赛', abbr: 'UKR', aliases: ['乌克兰队'] },
  { name: '匈牙利', league: '国际赛', abbr: 'HUN', aliases: ['匈牙利队'] },
  { name: '罗马尼亚', league: '国际赛', abbr: 'ROU', aliases: ['罗马尼亚队'] },
  { name: '斯洛伐克', league: '国际赛', abbr: 'SVK', aliases: ['斯洛伐克队'] },
  { name: '斯洛文尼亚', league: '国际赛', abbr: 'SVN', aliases: ['斯洛文尼亚队'] },
  { name: '波黑', league: '国际赛', abbr: 'BIH', aliases: ['波斯尼亚', '波黑队', '波斯尼亚和黑塞哥维那'] },
  { name: '黑山', league: '国际赛', abbr: 'MNE', aliases: ['黑山队'] },
  { name: '北马其顿', league: '国际赛', abbr: 'MKD', aliases: ['北马其顿队', '马其顿'] },
  { name: '阿尔巴尼亚', league: '国际赛', abbr: 'ALB', aliases: ['阿尔巴尼亚队'] },
  { name: '保加利亚', league: '国际赛', abbr: 'BUL', aliases: ['保加利亚队'] },
  { name: '希腊', league: '国际赛', abbr: 'GRE', aliases: ['希腊队'] },
  { name: '土耳其', league: '国际赛', abbr: 'TUR', aliases: ['土耳其队'] },
  { name: '格鲁吉亚', league: '国际赛', abbr: 'GEO', aliases: ['格鲁吉亚队'] },
  { name: '科索沃', league: '国际赛', abbr: 'KVX', aliases: ['科索沃队'] },
  { name: '白俄罗斯', league: '国际赛', abbr: 'BLR', aliases: ['白俄罗斯队'] },
  { name: '俄罗斯', league: '国际赛', abbr: 'RUS', aliases: ['俄罗斯队'] },

  // Europe - Other
  { name: '以色列', league: '国际赛', abbr: 'ISR', aliases: ['以色列队'] },
  { name: '塞浦路斯', league: '国际赛', abbr: 'CYP', aliases: ['塞浦路斯队'] },
  { name: '卢森堡', league: '国际赛', abbr: 'LUX', aliases: ['卢森堡队'] },
  { name: '亚美尼亚', league: '国际赛', abbr: 'ARM', aliases: ['亚美尼亚队'] },
  { name: '阿塞拜疆', league: '国际赛', abbr: 'AZE', aliases: ['阿塞拜疆队'] },
  { name: '爱沙尼亚', league: '国际赛', abbr: 'EST', aliases: ['爱沙尼亚队'] },
  { name: '拉脱维亚', league: '国际赛', abbr: 'LVA', aliases: ['拉脱维亚队'] },
  { name: '立陶宛', league: '国际赛', abbr: 'LTU', aliases: ['立陶宛队'] },

  // Africa
  { name: '摩洛哥', league: '国际赛', abbr: 'MAR', aliases: ['摩洛哥队', '阿特拉斯雄狮'] },
  { name: '塞内加尔', league: '国际赛', abbr: 'SEN', aliases: ['塞内加尔队'] },
  { name: '尼日利亚', league: '国际赛', abbr: 'NGA', aliases: ['尼日利亚队', '超级雄鹰'] },
  { name: '喀麦隆', league: '国际赛', abbr: 'CMR', aliases: ['喀麦隆队', '非洲雄狮'] },
  { name: '加纳', league: '国际赛', abbr: 'GHA', aliases: ['加纳队', '黑星'] },
  { name: '埃及', league: '国际赛', abbr: 'EGY', aliases: ['埃及队', '法老'] },
  { name: '阿尔及利亚', league: '国际赛', abbr: 'ALG', aliases: ['阿尔及利亚队'] },
  { name: '突尼斯', league: '国际赛', abbr: 'TUN', aliases: ['突尼斯队'] },
  { name: '科特迪瓦', league: '国际赛', abbr: 'CIV', aliases: ['象牙海岸', '科特迪瓦队'] },
  { name: '马里', league: '国际赛', abbr: 'MLI', aliases: ['马里队'] },
  { name: '布基纳法索', league: '国际赛', abbr: 'BFA', aliases: ['布基纳法索队'] },
  { name: '南非', league: '国际赛', abbr: 'RSA', aliases: ['南非队'] },
  { name: '刚果民主', league: '国际赛', abbr: 'COD', aliases: ['刚果金', 'DR刚果'] },
  { name: '刚果', league: '国际赛', abbr: 'CGO', aliases: ['刚果共和国', '刚果布'] },
  { name: '几内亚', league: '国际赛', abbr: 'GUI', aliases: ['几内亚队'] },
  { name: '赞比亚', league: '国际赛', abbr: 'ZAM', aliases: ['赞比亚队'] },
  { name: '佛得角', league: '国际赛', abbr: 'CPV', aliases: ['佛得角队'] },
  { name: '莫桑比克', league: '国际赛', abbr: 'MOZ', aliases: ['莫桑比克队'] },
  { name: '坦桑尼亚', league: '国际赛', abbr: 'TAN', aliases: ['坦桑尼亚队'] },
  { name: '乌干达', league: '国际赛', abbr: 'UGA', aliases: ['乌干达队'] },
  { name: '贝宁', league: '国际赛', abbr: 'BEN', aliases: ['贝宁队'] },
  { name: '加蓬', league: '国际赛', abbr: 'GAB', aliases: ['加蓬队'] },
  { name: '赤道几内亚', league: '国际赛', abbr: 'EQG', aliases: ['赤道几内亚队'] },
  { name: '安哥拉', league: '国际赛', abbr: 'ANG', aliases: ['安哥拉队'] },
  { name: '肯尼亚', league: '国际赛', abbr: 'KEN', aliases: ['肯尼亚队'] },
  { name: '利比亚', league: '国际赛', abbr: 'LBY', aliases: ['利比亚队'] },
  { name: '纳米比亚', league: '国际赛', abbr: 'NAM', aliases: ['纳米比亚队'] },
  { name: '马达加斯加', league: '国际赛', abbr: 'MAD', aliases: ['马达加斯加队'] },

  // Asia
  { name: '日本', league: '国际赛', abbr: 'JPN', aliases: ['日本队', '蓝色武士'] },
  { name: '韩国', league: '国际赛', abbr: 'KOR', aliases: ['韩国队', '太极虎'] },
  { name: '中国', league: '国际赛', abbr: 'CHN', aliases: ['中国队', '国足'] },
  { name: '伊朗', league: '国际赛', abbr: 'IRN', aliases: ['伊朗队', '波斯铁骑'] },
  { name: '澳大利亚', league: '国际赛', abbr: 'AUS', aliases: ['澳大利亚队', '袋鼠军团'] },
  { name: '沙特阿拉伯', league: '国际赛', abbr: 'KSA', aliases: ['沙特', '沙特队'] },
  { name: '卡塔尔', league: '国际赛', abbr: 'QAT', aliases: ['卡塔尔队'] },
  { name: '阿联酋', league: '国际赛', abbr: 'UAE', aliases: ['阿联酋队'] },
  { name: '伊拉克', league: '国际赛', abbr: 'IRQ', aliases: ['伊拉克队'] },
  { name: '乌兹别克斯坦', league: '国际赛', abbr: 'UZB', aliases: ['乌兹别克', '乌兹别克斯坦队'] },
  { name: '泰国', league: '国际赛', abbr: 'THA', aliases: ['泰国队'] },
  { name: '越南', league: '国际赛', abbr: 'VIE', aliases: ['越南队'] },
  { name: '印度', league: '国际赛', abbr: 'IND', aliases: ['印度队'] },
  { name: '约旦', league: '国际赛', abbr: 'JOR', aliases: ['约旦队'] },
  { name: '巴林', league: '国际赛', abbr: 'BHR', aliases: ['巴林队'] },
  { name: '阿曼', league: '国际赛', abbr: 'OMA', aliases: ['阿曼队'] },
  { name: '叙利亚', league: '国际赛', abbr: 'SYR', aliases: ['叙利亚队'] },
  { name: '巴勒斯坦', league: '国际赛', abbr: 'PLE', aliases: ['巴勒斯坦队'] },
  { name: '黎巴嫩', league: '国际赛', abbr: 'LBN', aliases: ['黎巴嫩队'] },
  { name: '吉尔吉斯斯坦', league: '国际赛', abbr: 'KGZ', aliases: ['吉尔吉斯'] },
  { name: '塔吉克斯坦', league: '国际赛', abbr: 'TJK', aliases: ['塔吉克'] },
  { name: '印度尼西亚', league: '国际赛', abbr: 'IDN', aliases: ['印尼', '印度尼西亚队'] },
  { name: '马来西亚', league: '国际赛', abbr: 'MAS', aliases: ['马来西亚队', '大马'] },
  { name: '朝鲜', league: '国际赛', abbr: 'PRK', aliases: ['朝鲜队'] },
  { name: '缅甸', league: '国际赛', abbr: 'MYA', aliases: ['缅甸队'] },
  { name: '土库曼斯坦', league: '国际赛', abbr: 'TKM', aliases: ['土库曼'] },
  { name: '新加坡', league: '国际赛', abbr: 'SGP', aliases: ['新加坡队'] },
  { name: '菲律宾', league: '国际赛', abbr: 'PHI', aliases: ['菲律宾队'] },
  { name: '中国香港', league: '国际赛', abbr: 'HKG', aliases: ['香港', '香港队'] },
  { name: '中国台北', league: '国际赛', abbr: 'TPE', aliases: ['台北', '中华台北'] },

  // North & Central America + Caribbean
  { name: '墨西哥', league: '国际赛', abbr: 'MEX', aliases: ['墨西哥队'] },
  { name: '美国', league: '国际赛', abbr: 'USA', aliases: ['美国队'] },
  { name: '加拿大', league: '国际赛', abbr: 'CAN', aliases: ['加拿大队'] },
  { name: '哥斯达黎加', league: '国际赛', abbr: 'CRC', aliases: ['哥斯达黎加队'] },
  { name: '洪都拉斯', league: '国际赛', abbr: 'HON', aliases: ['洪都拉斯队'] },
  { name: '巴拿马', league: '国际赛', abbr: 'PAN', aliases: ['巴拿马队'] },
  { name: '牙买加', league: '国际赛', abbr: 'JAM', aliases: ['牙买加队'] },
  { name: '萨尔瓦多', league: '国际赛', abbr: 'SLV', aliases: ['萨尔瓦多队'] },
  { name: '特立尼达和多巴哥', league: '国际赛', abbr: 'TRI', aliases: ['特多', '特立尼达'] },
  { name: '危地马拉', league: '国际赛', abbr: 'GUA', aliases: ['危地马拉队'] },
  { name: '库拉索', league: '国际赛', abbr: 'CUW', aliases: ['库拉索队'] },
  { name: '海地', league: '国际赛', abbr: 'HAI', aliases: ['海地队'] },

  // Oceania
  { name: '新西兰', league: '国际赛', abbr: 'NZL', aliases: ['新西兰队', '全白队'] },

];

// ============================================================
//  LOOKUP FUNCTION
// ============================================================

/**
 * Look up a team by Chinese name input.
 *
 * Strategy (in order):
 *   1. Exact match on `name`
 *   2. Exact match on any `aliases` entry
 *   3. Substring / prefix match on `name` or `aliases`
 *
 * @param {string} inputName - The user-typed team name (Chinese)
 * @returns {{ name: string, league: string, abbr: string } | null}
 */
export const lookupTeam = (inputName) => {
  if (!inputName || typeof inputName !== 'string') return null;
  const q = inputName.trim();
  if (q.length === 0) return null;

  // 1. Exact match on canonical name
  for (const team of TEAM_DB) {
    if (team.name === q) {
      return { name: team.name, league: team.league, abbr: team.abbr };
    }
  }

  // 2. Exact match on any alias
  for (const team of TEAM_DB) {
    if (team.aliases && team.aliases.some((a) => a === q)) {
      return { name: team.name, league: team.league, abbr: team.abbr };
    }
  }

  // 3. Substring / prefix match — input is substring of name/alias, or name/alias is substring of input
  //    Prioritise shorter matches (more specific).
  let bestMatch = null;
  let bestLen = Infinity;

  for (const team of TEAM_DB) {
    const candidates = [team.name, ...(team.aliases || [])];
    for (const c of candidates) {
      if (c.includes(q) || q.includes(c)) {
        // Prefer matches where the candidate length is closest to the query length
        const diff = Math.abs(c.length - q.length);
        if (diff < bestLen) {
          bestLen = diff;
          bestMatch = team;
        }
      }
    }
  }

  if (bestMatch) {
    return { name: bestMatch.name, league: bestMatch.league, abbr: bestMatch.abbr };
  }

  return null;
};
