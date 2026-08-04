// 每日一句 · 鼓励诗词（按日期哈希选一句，跨天自动换，可手动换）
// 纯前端，不发请求，不写云端（云端空间留给真正需要同步的数据）
(function () {
  'use strict';

  // 诗词库 64 条 · 偏"激励/坚持/希望/笃行"气质
  const QUOTES = [
    // —— 古诗 ——
    { t: '长风破浪会有时，直挂云帆济沧海。', a: '李白 · 行路难' },
    { t: '千磨万击还坚劲，任尔东西南北风。', a: '郑燮 · 竹石' },
    { t: '宝剑锋从磨砺出，梅花香自苦寒来。', a: '《警世贤文》' },
    { t: '纸上得来终觉浅，绝知此事要躬行。', a: '陆游 · 冬夜读书示子聿' },
    { t: '黑发不知勤学早，白首方悔读书迟。', a: '颜真卿 · 劝学' },
    { t: '少壮不努力，老大徒伤悲。', a: '汉乐府 · 长歌行' },
    { t: '不畏浮云遮望眼，自缘身在最高层。', a: '王安石 · 登飞来峰' },
    { t: '会当凌绝顶，一览众山小。', a: '杜甫 · 望岳' },
    { t: '莫愁前路无知己，天下谁人不识君。', a: '高适 · 别董大' },
    { t: '天生我材必有用，千金散尽还复来。', a: '李白 · 将进酒' },
    { t: '博观而约取，厚积而薄发。', a: '苏轼 · 稼说送张琥' },
    { t: '古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。', a: '苏轼 · 晁错论' },
    { t: '路漫漫其修远兮，吾将上下而求索。', a: '屈原 · 离骚' },
    { t: '老当益壮，宁移白首之心；穷且益坚，不坠青云之志。', a: '王勃 · 滕王阁序' },
    { t: '海纳百川，有容乃大；壁立千仞，无欲则刚。', a: '林则徐' },
    { t: '沉舟侧畔千帆过，病树前头万木春。', a: '刘禹锡 · 酬乐天扬州初逢席上见赠' },
    { t: '山重水复疑无路，柳暗花明又一村。', a: '陆游 · 游山西村' },
    { t: '落红不是无情物，化作春泥更护花。', a: '龚自珍 · 己亥杂诗' },
    { t: '苟利国家生死以，岂因祸福避趋之。', a: '林则徐 · 赴戍登程口占示家人' },
    { t: '人生自古谁无死，留取丹心照汗青。', a: '文天祥 · 过零丁洋' },
    { t: '莫等闲、白了少年头，空悲切。', a: '岳飞 · 满江红' },
    { t: '了却君王天下事，赢得生前身后名。', a: '辛弃疾 · 破阵子' },
    { t: '春风得意马蹄疾，一日看尽长安花。', a: '孟郊 · 登科后' },
    { t: '仰天大笑出门去，我辈岂是蓬蒿人。', a: '李白 · 南陵别儿童入京' },
    { t: '咬定青山不放松，立根原在破岩中。', a: '郑燮 · 竹石' },
    { t: '少年辛苦终身事，莫向光阴惰寸功。', a: '杜荀鹤 · 题弟侄书堂' },
    { t: '读书破万卷，下笔如有神。', a: '杜甫 · 奉赠韦左丞丈二十二韵' },
    { t: '业精于勤荒于嬉，行成于思毁于随。', a: '韩愈 · 进学解' },
    { t: '盛年不重来，一日难再晨。及时当勉励，岁月不待人。', a: '陶渊明 · 杂诗' },
    { t: '欲穷千里目，更上一层楼。', a: '王之涣 · 登鹳雀楼' },
    { t: '粉骨碎身浑不怕，要留清白在人间。', a: '于谦 · 石灰吟' },
    { t: '不经一番寒彻骨，怎得梅花扑鼻香。', a: '黄檗禅师 · 上堂开示颂' },
    { t: '问渠那得清如许，为有源头活水来。', a: '朱熹 · 观书有感' },
    { t: '古人学问无遗力，少壮工夫老始成。', a: '陆游 · 冬夜读书示子聿（其二）' },
    { t: '身无彩凤双飞翼，心有灵犀一点通。', a: '李商隐 · 无题' },
    { t: '两情若是久长时，又岂在朝朝暮暮。', a: '秦观 · 鹊桥仙' },
    { t: '身既死兮神以灵，魂魄毅兮为鬼雄。', a: '屈原 · 国殇' },
    { t: '黄沙百战穿金甲，不破楼兰终不还。', a: '王昌龄 · 从军行' },
    { t: '但愿苍生俱饱暖，不辞辛苦出山林。', a: '于谦 · 咏煤炭' },
    { t: '安得广厦千万间，大庇天下寒士俱欢颜。', a: '杜甫 · 茅屋为秋风所破歌' },
    { t: '少年心事当拏云，谁念幽寒坐呜呃。', a: '李贺 · 致酒行' },
    { t: '不识庐山真面目，只缘身在此山中。', a: '苏轼 · 题西林壁' },
    { t: '看似寻常最奇崛，成如容易却艰辛。', a: '王安石 · 题张司业诗' },
    { t: '问君能有几多愁，恰似一江春水向东流。', a: '李煜 · 虞美人' },
    { t: '大鹏一日同风起，扶摇直上九万里。', a: '李白 · 上李邕' },
    { t: '宁可枝头抱香死，何曾吹落北风中。', a: '郑思肖 · 画菊' },
    // —— 古籍名句 ——
    { t: '天行健，君子以自强不息。', a: '《周易》' },
    { t: '天将降大任于斯人也，必先苦其心志，劳其筋骨。', a: '《孟子》' },
    { t: '千里之行，始于足下。', a: '《老子》' },
    { t: '学而不思则罔，思而不学则殆。', a: '《论语》' },
    { t: '不积跬步，无以至千里；不积小流，无以成江海。', a: '《荀子》' },
    { t: '知之者不如好之者，好之者不如乐之者。', a: '《论语》' },
    { t: '学而时习之，不亦说乎。', a: '《论语》' },
    { t: '千里之堤，溃于蚁穴。', a: '《韩非子》' },
    { t: '路遥知马力，日久见人心。', a: '《元曲选·争报恩》' },
    { t: '工欲善其事，必先利其器。', a: '《论语》' },
    { t: '玉不琢，不成器；人不学，不知道。', a: '《礼记·学记》' },
    { t: '知人者智，自知者明。胜人者有力，自胜者强。', a: '《老子》' },
    { t: '穷则独善其身，达则兼济天下。', a: '《孟子》' },
    // —— 现代/近代 ——
    { t: '愿你走出半生，归来仍是少年。', a: '苏轼（改编）' },
    { t: '今天比昨天更好，就是意义。', a: '无名' },
    { t: '既然选择了远方，便只顾风雨兼程。', a: '汪国真 · 热爱生命' },
    { t: '我不去想是否能够成功，既然选择了远方，便只顾风雨兼程。', a: '汪国真 · 热爱生命' },
    { t: '世上无难事，只要肯登攀。', a: '毛泽东 · 水调歌头·重上井冈山' },
    { t: '一万年太久，只争朝夕。', a: '毛泽东 · 满江红·和郭沫若同志' },
    { t: '数风流人物，还看今朝。', a: '毛泽东 · 沁园春·雪' },
    { t: '雄关漫道真如铁，而今迈步从头越。', a: '毛泽东 · 忆秦娥·娄山关' },
    { t: '没有比脚更长的路，没有比人更高的山。', a: '汪国真 · 山高路远' },
  ];

  const LS_KEY = 'daily_quote_offset_v1';

  // 用 yyyymmdd 当 seed 选一句；用户可手动 +offset 看别的
  function dayKey(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  function pickIndex(offset) {
    const k = dayKey(new Date());
    const off = offset || parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0;
    return (hashStr(String(k)) + off) % QUOTES.length;
  }

  function formatDate(d) {
    const w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日 · 周${w}`;
  }

  function render() {
    const card = document.getElementById('home-daily-quote');
    if (!card) return;
    const idx = pickIndex();
    const q = QUOTES[idx];
    const text = card.querySelector('.dq-text');
    const auth = card.querySelector('.dq-auth');
    const date = card.querySelector('.dq-date');
    if (text) text.textContent = q.t;
    if (auth) auth.textContent = `— ${q.a}`;
    if (date) date.textContent = formatDate(new Date());
    // 触发淡入
    card.classList.remove('dq-anim');
    void card.offsetWidth;
    card.classList.add('dq-anim');
  }

  function next() {
    const cur = parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0;
    localStorage.setItem(LS_KEY, String((cur + 1) % QUOTES.length));
    // 按钮 spin 反馈
    const btn = document.querySelector('#home-daily-quote .dq-refresh');
    if (btn) {
      btn.classList.remove('spin');
      void btn.offsetWidth;
      btn.classList.add('spin');
      setTimeout(() => btn.classList.remove('spin'), 700);
    }
    render();
  }

  // 暴露给首页"换一句"按钮
  window.DailyQuote = { render, next, QUOTES };

  // 跨天自动换：每分钟检查一次日期
  setInterval(() => {
    const k = 'dq_day';
    const today = dayKey(new Date());
    if (parseInt(localStorage.getItem(k) || '0', 10) !== today) {
      localStorage.setItem(k, String(today));
      // 新的一天，offset 清零
      localStorage.removeItem(LS_KEY);
      if (document.getElementById('page-home')?.classList.contains('active')) render();
    }
  }, 60 * 1000);
})();
