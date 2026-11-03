/** Decorative composition only; these nodes do not represent company data. */
export function LoginNetwork() {
  return (
    <div className="login-network" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="login-line" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#7a9380" stopOpacity=".05" />
            <stop offset=".65" stopColor="#9bad96" stopOpacity=".4" />
            <stop offset="1" stopColor="#c4ee77" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <g className="network-orbits" fill="none" stroke="#98aa92" strokeOpacity=".08">
          <circle cx="1150" cy="260" r="210" />
          <circle cx="1150" cy="260" r="285" strokeDasharray="3 14" />
          <circle cx="200" cy="720" r="165" />
          <path d="M40 240H310M175 105V375M1020 710H1340M1180 550V870" />
        </g>
        <g className="network-layer" fill="none" stroke="url(#login-line)" strokeWidth="1">
          <path d="M850 95L1000 165L1150 100L1310 180L1230 325L1080 360L1000 165L940 295L1080 360L1150 100M1310 180L1390 400L1230 325L1190 490M850 95Q790 270 940 295M1080 360Q960 510 1040 650" />
          <path d="M40 650L170 570L310 660L245 800L100 775L40 650M170 570L100 775M310 660L410 755L245 800M310 660Q470 510 430 390M410 755Q750 910 1040 650" />
          <path className="network-signal" d="M850 95L1000 165L1080 360L1230 325L1310 180" />
          {[[850,95],[1150,100],[1310,180],[1390,400],[1190,490],[940,295],[1040,650],[40,650],[170,570],[310,660],[100,775],[410,755],[430,390]].map(([cx,cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#6e8476" stroke="none" />
          ))}
          {[[1000,165],[1230,325],[1080,360],[245,800]].map(([cx,cy], index) => (
            <g key={cx} className="network-node" style={{ animationDelay: `${index * -2}s` }}>
              <circle cx={cx} cy={cy} r="13" stroke="#c4ee77" strokeOpacity=".18" />
              <circle cx={cx} cy={cy} r="4" fill="#c4ee77" stroke="none" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
