"""PyQt6 QThread worker executing the computer vision and vectorization pipeline asynchronously."""

import os
import sys
import traceback
from typing import Any, Dict, Optional
from PyQt6.QtCore import QThread, pyqtSignal

# Import CV modules from dxferpy
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DXFERPY_DIR = os.path.join(REPO_ROOT, "dxferpy")
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

from segment_object import create_birefnet_session
from pipeline_worker import run_pipeline


class PipelineWorkerThread(QThread):
    """Asynchronous background worker thread executing image segmentation and DXF conversion."""

    started_processing = pyqtSignal()
    finished_processing = pyqtSignal(dict)
    error_occurred = pyqtSignal(str, str)

    def __init__(
        self,
        input_path: str,
        output_dir: str,
        params: Dict[str, Any],
        session: Any = None,
        parent: Optional[Any] = None,
    ) -> None:
        super().__init__(parent)
        self.input_path = input_path
        self.output_dir = output_dir
        self.params = params
        self.session = session

    def run(self) -> None:
        """Executes full computer vision pipeline."""
        try:
            self.started_processing.emit()
            if self.session is None:
                self.session = create_birefnet_session()
            paper_size = self.params.pop("paperSize", "a4")

            report = run_pipeline(
                self.input_path,
                self.output_dir,
                paper_size=paper_size,
                session=self.session,
                **self.params,
            )
            self.finished_processing.emit(report)
        except Exception as err:
            self.error_occurred.emit(str(err), traceback.format_exc())
