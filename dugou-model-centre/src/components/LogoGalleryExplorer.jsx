const DIAMOND_V2_LOGO = (
  <div className="lg-v2-icon">
    <div className="lg-v2-edge-catch"></div>
    <div className="lg-v2-facet lg-v2-tl"><span>H</span></div>
    <div className="lg-v2-facet lg-v2-tr"><span>D</span></div>
    <div className="lg-v2-facet lg-v2-bl"><span>C</span></div>
    <div className="lg-v2-facet lg-v2-br"><span>S</span></div>
    <div className="lg-v2-cross-h"></div>
    <div className="lg-v2-cross-v"></div>
    <div className="lg-v2-gem"></div>
  </div>
)

const DIAMOND_V4_LOGO = (
  <div className="lg-v4-icon">
    <div className="lg-v4-facet lg-v4-tl"><span>H</span></div>
    <div className="lg-v4-facet lg-v4-tr"><span>D</span></div>
    <div className="lg-v4-facet lg-v4-bl"><span>C</span></div>
    <div className="lg-v4-facet lg-v4-br"><span>S</span></div>
    <div className="lg-v4-gem-wrap">
      <div className="lg-v4-gem"></div>
      <div className="lg-v4-ray"></div>
      <div className="lg-v4-ray"></div>
      <div className="lg-v4-ray"></div>
      <div className="lg-v4-ray"></div>
    </div>
    <div className="lg-v4-flow-h-l"></div>
    <div className="lg-v4-flow-h-r"></div>
    <div className="lg-v4-flow-v-t"></div>
    <div className="lg-v4-flow-v-b"></div>
  </div>
)

const DIAMOND_V5_LOGO = (
  <div className="lg-v5-icon">
    <div className="lg-v5-edge-catch"></div>
    <div className="lg-v5-facet lg-v5-tl"><span>H</span></div>
    <div className="lg-v5-facet lg-v5-tr"><span>D</span></div>
    <div className="lg-v5-facet lg-v5-bl"><span>C</span></div>
    <div className="lg-v5-facet lg-v5-br"><span>S</span></div>
    <div className="lg-v5-cross-h"></div>
    <div className="lg-v5-cross-v"></div>
    <div className="lg-v5-slash"></div>
    <div className="lg-v5-gem">
      <div className="lg-v5-gem-inner"></div>
    </div>
    <div className="lg-v5-flow-h-l"></div>
    <div className="lg-v5-flow-h-r"></div>
    <div className="lg-v5-flow-v-t"></div>
    <div className="lg-v5-flow-v-b"></div>
  </div>
)

const DIAMOND_V6_LOGO = (
  <div className="lg-v6-icon">
    <div className="lg-v6-inner"></div>
    <div className="lg-v6-facet lg-v6-tl"><span>H</span></div>
    <div className="lg-v6-facet lg-v6-tr"><span>D</span></div>
    <div className="lg-v6-facet lg-v6-bl"><span>C</span></div>
    <div className="lg-v6-facet lg-v6-br"><span>S</span></div>
    <div className="lg-v6-cross-h"></div>
    <div className="lg-v6-cross-v"></div>
    <div className="lg-v6-sweep"></div>
    <div className="lg-v6-gem-wrap">
      <div className="lg-v6-gem-outer">
        <div className="lg-v6-gem-core"></div>
      </div>
    </div>
  </div>
)

const WAX_S2_LOGO = (
  <div className="lg-seal">
    <div className="lg-seal-ring-outer"></div>
    <div className="lg-seal-ring-inner"></div>
    <span className="lg-seal-hd">HD</span>
    <div className="lg-seal-divider"></div>
    <span className="lg-seal-cs">CS</span>
    <div className="lg-s2-orbit-track-a">
      <div className="lg-s2-dot-a"></div>
      <div className="lg-s2-trail-a1"></div>
      <div className="lg-s2-trail-a2"></div>
    </div>
    <div className="lg-s2-orbit-track-b">
      <div className="lg-s2-dot-b"></div>
      <div className="lg-s2-trail-b1"></div>
    </div>
  </div>
)

const WAX_S3_LOGO = (
  <div className="lg-seal">
    <div className="lg-seal-ring-outer"></div>
    <div className="lg-seal-ring-inner"></div>
    <div className="lg-seal-highlight"></div>
    <span className="lg-seal-hd">HD</span>
    <div className="lg-seal-divider"></div>
    <span className="lg-seal-cs">CS</span>
  </div>
)

const WAX_S4_LOGO = (
  <div className="lg-seal">
    <div className="lg-seal-ring-outer"></div>
    <div className="lg-seal-ring-inner"></div>
    <span className="lg-seal-hd">HD</span>
    <div className="lg-seal-divider"></div>
    <span className="lg-seal-cs">CS</span>
  </div>
)

const WAX_S5_LOGO = (
  <div className="lg-seal">
    <div className="lg-seal-ring-outer"></div>
    <div className="lg-seal-ring-inner"></div>
    <div className="lg-seal-shimmer"></div>
    <span className="lg-seal-hd">HD</span>
    <div className="lg-seal-divider"></div>
    <span className="lg-seal-cs">CS</span>
  </div>
)

const LOGO_VARIANTS = [
  {
    id: 'V2',
    stageClass: 'lg-v2-stage',
    familyClass: 'logo-gallery-stage--diamond',
    infoNum: 'V2 · Brilliant Edge',
    infoName: '棱光锋芒 · D1 + D3',
    infoDesc: '切面流光 + 棱线捕光。光带在切面上扫过的同时，一道亮线沿边框快速划过——像宝石被旋转时两种光效的叠加。',
    logo: DIAMOND_V2_LOGO,
  },
  {
    id: 'V4',
    stageClass: 'lg-v4-stage',
    familyClass: 'logo-gallery-stage--diamond',
    infoNum: 'V4 · Luminous Cut',
    infoName: '通透光琢 · D1 + D5',
    infoDesc: '切面流光 + 十字光流。最通透的版本——光带扫过半透明切面，同时金色光粒子从中心沿十字线向四方发射扩散。内部有光在流动。',
    logo: DIAMOND_V4_LOGO,
  },
  {
    id: 'V5',
    stageClass: 'lg-v5-stage',
    familyClass: 'logo-gallery-stage--diamond',
    infoNum: 'V5 · Sharp Youth',
    infoName: '少年锋芒 · D3 + D5',
    infoDesc: '棱线捕光 + 十字光流。锐利的一道亮线沿边框划过，加上从中心向四方发射的校准信号感光粒子。最具动感和科技感的组合。',
    logo: DIAMOND_V5_LOGO,
  },
  {
    id: 'V6',
    stageClass: 'lg-v6-stage',
    familyClass: 'logo-gallery-stage--diamond',
    infoNum: 'V6 · Celestial Facet',
    infoName: '星辰切面 · D1 + D2 + D4',
    infoDesc: '切面流光 + 宝石呼吸 + 色温游移。三层动画：光带扫过、宝石呼吸脉冲、切面色温游移——集大成的温润生命力。推荐方向。',
    logo: DIAMOND_V6_LOGO,
  },
  {
    id: 'S2',
    stageClass: 'lg-wax-stage lg-s2',
    familyClass: 'logo-gallery-stage--wax',
    infoNum: 'S2 · Dual Orbit ✦ New',
    infoName: '双星巡环',
    infoDesc: '两颗金色光粒子以不同速度相向运行——大粒子5s顺时针、小粒子7s逆时针，各带尾迹。双卫星精密仪器感。',
    logo: WAX_S2_LOGO,
  },
  {
    id: 'S3',
    stageClass: 'lg-wax-stage lg-s3',
    familyClass: 'logo-gallery-stage--wax',
    infoNum: 'S3 · Emboss Glow',
    infoName: '浮雕光晕',
    infoDesc: '增强版——侧光旋转带来的shadow角度偏移 + 蜡面光楔扫过 + 文字浮雕阴影跟随变化。暗色上的光影雕塑。6s周期。',
    logo: WAX_S3_LOGO,
  },
  {
    id: 'S4',
    stageClass: 'lg-wax-stage lg-s4',
    familyClass: 'logo-gallery-stage--wax',
    infoNum: 'S4 · Gold Line Ignite',
    infoName: '金线点燃',
    infoDesc: '金色分割线从中心向两端展开"点燃"，HD和CS随后出现golden text-shadow。火漆加热时金箔发光的瞬间。3.5s周期。',
    logo: WAX_S4_LOGO,
  },
  {
    id: 'S5',
    stageClass: 'lg-wax-stage lg-s5',
    familyClass: 'logo-gallery-stage--wax',
    infoNum: 'S5 · Wax Shimmer',
    infoName: '蜡面流光',
    infoDesc: '一束极细的高光在印章深色蜡面上缓慢扫过——像黑曜石在光下微微转动时表面那道不经意的光泽。5s周期。最subtle。',
    logo: WAX_S5_LOGO,
  },
]

const PREVIEW_VARIANTS = ['V2', 'S2', 'S5']

const findVariant = (id) => LOGO_VARIANTS.find((item) => item.id === id)

const LogoCard = ({ variant }) => (
  <article className="logo-gallery-card">
    <div className={`logo-gallery-stage ${variant.familyClass} ${variant.stageClass}`}>{variant.logo}</div>
    <div className="logo-gallery-info">
      <div className="logo-gallery-info-num">{variant.infoNum}</div>
      <div className="logo-gallery-info-name">{variant.infoName}</div>
      <div className="logo-gallery-info-desc">{variant.infoDesc}</div>
    </div>
  </article>
)

export const LogoGalleryPreview = ({ onOpen }) => {
  const previewItems = PREVIEW_VARIANTS.map(findVariant).filter(Boolean)

  return (
    <div className="logo-gallery-canvas mt-4">
      <div className="logo-gallery-preview-grid">
        {previewItems.map((variant) => (
          <button
            key={variant.id}
            type="button"
            onClick={onOpen}
            className="logo-gallery-preview-card text-left"
          >
            <div className={`logo-gallery-preview-stage ${variant.familyClass} ${variant.stageClass}`}>{variant.logo}</div>
            <div className="logo-gallery-preview-meta">
              <p className="logo-gallery-preview-id">{variant.id}</p>
              <p className="logo-gallery-preview-name">{variant.infoName}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export const LogoGalleryExplorer = () => {
  return (
    <div className="logo-gallery-modal h-[75vh] rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50/95 via-white/90 to-cyan-50/85 shadow-[0_30px_70px_rgba(56,189,248,0.2),inset_0_1px_0_rgba(255,255,255,0.92)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_8%_0%,rgba(125,211,252,0.28),rgba(255,255,255,0))]" />
      <div className="logo-gallery-canvas relative h-full overflow-y-auto custom-scrollbar px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-sky-700">Logo Customization Gallery</p>
            <h4 className="mt-1 text-lg font-semibold text-stone-800">logo自定义 · Motion 展览馆</h4>
            <p className="mt-1.5 text-xs text-stone-500">V2 / V4 / V5 / V6 与 S2 / S3 / S4 / S5 原稿全量展陈。</p>
          </div>
          <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
            8 Concepts
          </span>
        </div>

        <div className="logo-gallery-grid mt-4 pb-2">
          {LOGO_VARIANTS.map((variant) => (
            <LogoCard key={variant.id} variant={variant} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default LogoGalleryExplorer
