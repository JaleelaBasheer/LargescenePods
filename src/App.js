import './App.css';
import FbxtoGlb from './Components/FbxtoGlb';
import FbxToGlbFinalLargeScene from './Components/FbxToGlbFinalLargeScene';
import FbxToGlbLargeScene from './Components/FbxToGlbLargeScene';
import IndexedDbRandomFbx from './Components/IndexedDbRandomFbx';
import RandomBoxesScene from './Components/RandomBoxes';
import RandomFBXFiles from './Components/RandomFBXFiles';
import TestScene from './Components/TestScene';
import TestSceneFbx from './Components/TestSceneFbx';

function App() {
  return (
    <div >
      {/* <RandomBoxesScene/> */}
      {/* <RandomFBXFiles/> */}
      {/* <IndexedDbRandomFbx/> */}
      {/* <FbxtoGlb/> */}
      <FbxToGlbLargeScene/>
      {/* <FbxToGlbFinalLargeScene/> */}
      {/* <TestScene/> */}
      {/* <TestSceneFbx/> */}
     
    </div>
  );
}

export default App;
